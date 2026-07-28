// Reminder SMS for invoices approaching, at, or past their due date. Built
// the same shape as reconcileSchool: a plain per-school function, callable
// on any cadence via /api/admin/reminders (secret-protected, same pattern as
// /api/admin/reconcile) — a Vercel Cron schedule decides how often it runs.
//
// Idempotency policy (queried from message_logs, not a new DB column):
//   advance / due  — sent once ever per invoice (the due date doesn't move).
//   overdue        — repeated using REAL elapsed time since the last one
//                     (overdueIntervalMinutes), not calendar-day counting —
//                     so the same repeat logic works whether a school wants
//                     "every 7 days" or a test wants "every 2 minutes."
//                     Capped at overdueMaxReminders if the school set one.
// Frequency/thresholds are school-configurable (schools.settings.reminders,
// see src/lib/queries/reminders.ts) — these are per-school, not global.

import { composeReminderSMS, composeOverdueSMS } from './composeInvoice'
import { sendMessageWithFallback, MessageType } from './sendMessage'
import { mergeReminderSettings } from '@/lib/queries/reminders'
import { getSchoolSmsName } from './schoolSmsName'

function daysBetween(from: Date, to: Date): number {
  const ms = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
    - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  return Math.round(ms / 86_400_000)
}

export interface ReminderResult {
  schoolId: string
  invoicesChecked: number
  sent: { advance: number; due: number; overdue: number }
  skipped: number
  errors: string[]
}

export async function sendDueRemindersForSchool(schoolId: string, supabase: any): Promise<ReminderResult> {
  const result: ReminderResult = {
    schoolId,
    invoicesChecked: 0,
    sent: { advance: 0, due: 0, overdue: 0 },
    skipped: 0,
    errors: [],
  }

  const { data: school } = await supabase.from('schools').select('name, settings').eq('id', schoolId).single()
  const settings = mergeReminderSettings(schoolId, school?.settings?.reminders)
  if (!settings.enabled) return result

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id, outstanding_amount,
      billing_cycles!inner(name, due_date, status),
      students!inner(id, first_name, last_name, provider_dva_account_number,
        families(primary_parent_phone))
    `)
    .eq('school_id', schoolId)
    .neq('status', 'cancelled')
    .gt('outstanding_amount', 0)
    .neq('billing_cycles.status', 'closed')
    .not('billing_cycles.due_date', 'is', null)

  if (!invoices || invoices.length === 0) return result

  // One query for every prior reminder already logged for these invoices —
  // avoids an N+1 lookup per invoice.
  const invoiceIds = invoices.map((inv: any) => inv.id)
  const { data: priorReminders } = await supabase
    .from('message_logs')
    .select('related_invoice_id, message_type, created_at')
    .eq('school_id', schoolId)
    .in('message_type', ['reminder_advance', 'reminder_due', 'reminder_overdue'])
    .in('related_invoice_id', invoiceIds)

  const sentTypes = new Map<string, Set<string>>() // invoiceId -> set of message_types ever sent
  const lastOverdueAt = new Map<string, string>() // invoiceId -> most recent reminder_overdue created_at
  const overdueCount = new Map<string, number>() // invoiceId -> number of reminder_overdue ever sent
  for (const log of priorReminders || []) {
    const id = log.related_invoice_id
    if (!id) continue
    if (!sentTypes.has(id)) sentTypes.set(id, new Set())
    sentTypes.get(id)!.add(log.message_type)
    if (log.message_type === 'reminder_overdue') {
      const prev = lastOverdueAt.get(id)
      if (!prev || log.created_at > prev) lastOverdueAt.set(id, log.created_at)
      overdueCount.set(id, (overdueCount.get(id) || 0) + 1)
    }
  }

  const today = new Date()

  for (const invoice of invoices) {
    result.invoicesChecked++
    const student: any = invoice.students
    const family: any = student?.families
    const phone: string | undefined = family?.primary_parent_phone
    const accountNumber: string | undefined = student?.provider_dva_account_number
    const dueDate: string = (invoice.billing_cycles as any).due_date
    const termName: string = (invoice.billing_cycles as any).name || ''

    if (!phone || !accountNumber) {
      result.skipped++
      continue
    }

    const diff = daysBetween(today, new Date(dueDate))
    const already = sentTypes.get(invoice.id) || new Set<string>()

    let messageType: MessageType | null = null
    if (settings.advanceDays !== null && diff === settings.advanceDays && !already.has('reminder_advance')) {
      messageType = 'reminder_advance'
    } else if (settings.dueDayEnabled && diff === 0 && !already.has('reminder_due')) {
      messageType = 'reminder_due'
    } else if (settings.overdueEnabled && diff <= 0) {
      const sentSoFar = overdueCount.get(invoice.id) || 0
      const underCap = settings.overdueMaxReminders === null || sentSoFar < settings.overdueMaxReminders
      const last = lastOverdueAt.get(invoice.id)
      const minutesSinceLast = last ? (today.getTime() - new Date(last).getTime()) / 60_000 : Infinity
      const dueForAnother = minutesSinceLast >= settings.overdueIntervalMinutes
      if (underCap && dueForAnother) messageType = 'reminder_overdue'
    }

    if (!messageType) {
      result.skipped++
      continue
    }

    const isOverdue = messageType === 'reminder_overdue'
    const messageParams = {
      studentName: `${student.first_name} ${student.last_name}`.trim(),
      termName,
      balance: Number(invoice.outstanding_amount),
      dueDate,
      accountNumber,
    }
    const smsText = (isOverdue ? composeOverdueSMS : composeReminderSMS)({
      ...messageParams,
      schoolName: getSchoolSmsName(school),
    })

    try {
      const sendResult = await sendMessageWithFallback(
        { supabase, schoolId, messageType, studentId: student.id, invoiceId: invoice.id },
        { phone },
        { sms: smsText }
      )
      if (sendResult.ok) {
        if (messageType === 'reminder_advance') result.sent.advance++
        else if (messageType === 'reminder_due') result.sent.due++
        else result.sent.overdue++
      } else {
        result.errors.push(`invoice ${invoice.id}: failed on every available channel`)
      }
    } catch (err: any) {
      result.errors.push(`invoice ${invoice.id}: ${err?.message || 'unknown error'}`)
    }
  }

  return result
}
