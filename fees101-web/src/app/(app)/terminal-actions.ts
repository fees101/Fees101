'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { logAuditEvent } from '@/lib/audit/logAudit'
import {
  createTerminalCharge,
  getTerminalChargeStatus,
  refreshSchoolTerminals,
  labelTerminal,
  type TerminalChargeResult,
  type TerminalChargeStatus,
} from '@/lib/payments/terminal'

// --- Shared helpers ---

async function getUserName(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.from('users').select('name').eq('id', userId).maybeSingle()
  return (data?.name as string) || 'A staff member'
}

export interface TerminalForCharge {
  terminalId: string
  label: string
  status: string | null
}

// Registered devices for the charge flow's picker and the settings panel.
// Read via the user's RLS-scoped client (school_terminals has a school-scoped
// select policy), so no extra authorization is needed beyond being signed in.
export async function listTerminalsForCharge(): Promise<TerminalForCharge[]> {
  const ctx = await requirePermission('charge-on-terminal')
  if (!ctx || !ctx.schoolId) return []
  const { data } = await ctx.supabase
    .from('school_terminals')
    .select('terminal_id, label, status, serial')
    .eq('school_id', ctx.schoolId)
    .order('label', { ascending: true })
  return (data || []).map((t: any) => ({
    terminalId: t.terminal_id,
    label: t.label || t.serial || t.terminal_id,
    status: t.status ?? null,
  }))
}

// Push a charge to a device. Gated on charge-on-terminal; the service-role
// client does the actual writes (both terminal tables are read-only to sessions).
export async function chargeOnTerminal(params: {
  studentId: string
  invoiceId: string | null
  terminalId: string
  amount: number
}): Promise<TerminalChargeResult> {
  const ctx = await requirePermission('charge-on-terminal')
  if (!ctx || !ctx.schoolId) return { ok: false, error: 'Not authorized to charge on a terminal.' }

  const service = createServiceRoleClient()
  const pushedByName = await getUserName(ctx.supabase, ctx.userId)

  const result = await createTerminalCharge({
    schoolId: ctx.schoolId,
    studentId: params.studentId,
    invoiceId: params.invoiceId,
    terminalId: params.terminalId,
    amount: params.amount,
    pushedBy: ctx.userId,
    pushedByName,
    supabase: service,
  })

  if (result.ok) {
    await logAuditEvent(ctx.supabase, {
      schoolId: ctx.schoolId,
      actorId: ctx.userId,
      action: 'payment.terminal_charge_pushed',
      targetType: 'student',
      targetId: params.studentId,
      // Log what was actually pushed (capped to outstanding), not the raw input.
      summary: `Pushed a ₦${(result.amount ?? params.amount).toLocaleString()} terminal charge`,
      metadata: { invoiceId: params.invoiceId, terminalId: params.terminalId, requestId: result.requestId, amount: result.amount ?? params.amount },
    })
  }

  return result
}

// Poll a charge's status (the modal calls this on an interval). School-scoped
// via the explicit filter in getTerminalChargeStatus.
export async function pollTerminalCharge(requestId: string): Promise<TerminalChargeStatus | null> {
  const ctx = await requirePermission('charge-on-terminal')
  if (!ctx || !ctx.schoolId) return null
  const service = createServiceRoleClient()
  return getTerminalChargeStatus(requestId, ctx.schoolId, service)
}

// --- Settings: discover + label devices (manage-payment-config) ---

export async function refreshTerminals(): Promise<{ ok: boolean; count?: number; error?: string }> {
  const ctx = await requirePermission('manage-payment-config')
  if (!ctx || !ctx.schoolId) return { ok: false, error: 'Not authorized.' }
  const service = createServiceRoleClient()
  const result = await refreshSchoolTerminals(ctx.schoolId, service)
  if (!result.ok) return { ok: false, error: result.error }
  await logAuditEvent(ctx.supabase, {
    schoolId: ctx.schoolId,
    actorId: ctx.userId,
    action: 'payment_config.terminals_refreshed',
    targetType: 'school',
    targetId: ctx.schoolId,
    summary: `Refreshed card terminals (${result.terminals?.length ?? 0} found)`,
  })
  return { ok: true, count: result.terminals?.length ?? 0 }
}

export async function renameTerminal(
  terminalId: string,
  label: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermission('manage-payment-config')
  if (!ctx || !ctx.schoolId) return { ok: false, error: 'Not authorized.' }
  const service = createServiceRoleClient()
  return labelTerminal(ctx.schoolId, terminalId, label, service)
}

export interface SchoolTerminalRow {
  terminalId: string
  label: string
  serial: string | null
  status: string | null
  lastSeenAt: string | null
}

// Full device list for the settings panel.
export async function getSchoolTerminals(): Promise<SchoolTerminalRow[]> {
  const ctx = await requirePermission('manage-payment-config')
  if (!ctx || !ctx.schoolId) return []
  const { data } = await ctx.supabase
    .from('school_terminals')
    .select('terminal_id, label, serial, status, last_seen_at')
    .eq('school_id', ctx.schoolId)
    .order('label', { ascending: true })
  return (data || []).map((t: any) => ({
    terminalId: t.terminal_id,
    label: t.label || t.serial || t.terminal_id,
    serial: t.serial ?? null,
    status: t.status ?? null,
    lastSeenAt: t.last_seen_at ?? null,
  }))
}
