// Server-side logic for the in-person card POS (Paystack Terminal) rail.
// See docs/pos-terminal-integration.md.
//
// These functions take a SERVICE-ROLE Supabase client and do NOT check the
// caller's permission themselves — the server actions in
// src/app/(app)/terminal-actions.ts do that first (requirePermission), then call
// here. Writing school_terminals / terminal_payment_requests with the service
// role (both tables are read-only to user sessions) is what keeps a user from
// fabricating a 'paid' row by calling PostgREST directly.

import { randomUUID } from 'crypto'
import { getPaymentProviderForSchool } from './getProvider'
import type { TerminalInfo } from './types'

// How long a pushed charge stays live before the sweep expires it. A parent at
// the desk pays within a couple of minutes; 15 gives comfortable headroom.
const CHARGE_TTL_MS = 15 * 60 * 1000

export interface TerminalChargeResult {
  ok: boolean
  requestId?: string
  status?: string
  // The amount actually charged (after capping to the invoice outstanding), so
  // callers log/show what was really pushed rather than the raw request.
  amount?: number
  error?: string
}

// Confirms the school's provider supports Terminal (Paystack only) and returns
// it, or an error string. Shared by every entry point so the "Monnify school"
// message is identical everywhere.
async function getTerminalProvider(schoolId: string, supabase: any) {
  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) return { error: 'No payment provider is configured for this school.' as string }
  if (!provider.supportsTerminal?.()) {
    return { error: 'In-person card terminals are only available on Paystack.' as string }
  }
  return { provider }
}

// Discover + persist a school's registered devices. Upserts on
// (school_id, terminal_id) so re-running just refreshes labels/status, never
// duplicates. Keeps any label the school already set.
export async function refreshSchoolTerminals(
  schoolId: string,
  supabase: any
): Promise<{ ok: boolean; terminals?: TerminalInfo[]; error?: string }> {
  const { provider, error } = await getTerminalProvider(schoolId, supabase)
  if (error) return { ok: false, error }

  let discovered: TerminalInfo[]
  try {
    discovered = await provider!.listTerminals!()
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not reach Paystack to list terminals.' }
  }

  const now = new Date().toISOString()
  for (const t of discovered) {
    // Upsert without clobbering a school-set label: only set label when the row
    // is new (coalesce handled by reading existing first would be a round-trip
    // per device — instead upsert everything except label, then set label only
    // if currently null).
    await supabase
      .from('school_terminals')
      .upsert(
        {
          school_id: schoolId,
          terminal_id: t.terminalId,
          serial: t.serial ?? null,
          status: t.status ?? null,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: 'school_id,terminal_id' }
      )
    // Seed a default label only if none is set yet.
    await supabase
      .from('school_terminals')
      .update({ label: t.name || t.serial || t.terminalId })
      .eq('school_id', schoolId)
      .eq('terminal_id', t.terminalId)
      .is('label', null)
  }

  return { ok: true, terminals: discovered }
}

// Rename a device. Service-role write after the action checks manage-payment-config.
export async function labelTerminal(
  schoolId: string,
  terminalId: string,
  label: string,
  supabase: any
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('school_terminals')
    .update({ label: label.trim() || null, updated_at: new Date().toISOString() })
    .eq('school_id', schoolId)
    .eq('terminal_id', terminalId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Create a Paystack payment request and push it to a device. Inserts the
// terminal_payment_requests row the webhook will later flip to 'paid' and the UI
// polls. Amount is capped at the invoice's outstanding (never edited up).
export async function createTerminalCharge(params: {
  schoolId: string
  studentId: string
  invoiceId: string | null
  terminalId: string
  amount: number
  pushedBy: string
  pushedByName: string
  supabase: any
}): Promise<TerminalChargeResult> {
  const { schoolId, studentId, invoiceId, terminalId, amount, pushedBy, pushedByName, supabase } = params

  const { provider, error: provErr } = await getTerminalProvider(schoolId, supabase)
  if (provErr) return { ok: false, error: provErr }

  // The device must be one this school has registered with us.
  const { data: device } = await supabase
    .from('school_terminals')
    .select('terminal_id')
    .eq('school_id', schoolId)
    .eq('terminal_id', terminalId)
    .maybeSingle()
  if (!device) return { ok: false, error: 'That terminal is not registered to this school.' }

  // Load the student (for the customer code + a human line-item name) and, when
  // anchored to an invoice, the outstanding to cap the amount.
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, provider_dva_reference')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!student) return { ok: false, error: 'Student not found.' }

  let chargeAmount = Math.round(Number(amount) * 100) / 100
  if (!(chargeAmount > 0)) return { ok: false, error: 'Enter an amount greater than zero.' }

  if (invoiceId) {
    const { data: invoice } = await supabase
      .from('invoices')
      .select('id, outstanding_amount, status')
      .eq('id', invoiceId)
      .eq('school_id', schoolId)
      .maybeSingle()
    if (!invoice) return { ok: false, error: 'Invoice not found.' }
    if (invoice.status === 'cancelled') return { ok: false, error: 'This invoice has been cancelled.' }
    const outstanding = Number(invoice.outstanding_amount) || 0
    if (outstanding <= 0) return { ok: false, error: 'This invoice has nothing outstanding.' }
    // Cap up, allow partial down — never charge more than is owed on the anchor.
    if (chargeAmount > outstanding) chargeAmount = outstanding
  }

  const studentName = `${student.first_name} ${student.last_name}`.trim()
  const reference = `TERM-${randomUUID()}`

  // 1. Create the Paystack payment request.
  let pr
  try {
    pr = await provider!.createPaymentRequest!({
      amount: chargeAmount,
      description: `School fees — ${studentName}`,
      customerCode: student.provider_dva_reference || undefined,
      lineItems: [{ name: `School fees — ${studentName}`, amount: chargeAmount }],
      // Comes back in response.metadata on charge.success / paymentrequest.success
      // (Paystack-confirmed) — our stable, reliable reconciliation key.
      metadata: { fees101_reference: reference },
    })
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not create the charge on Paystack.' }
  }

  // 2. Record our row BEFORE pushing, so the webhook can always resolve it even
  // if the push response is slow/lost. Status 'pending' until the push confirms.
  const nowIso = new Date().toISOString()
  const { data: row, error: insertError } = await supabase
    .from('terminal_payment_requests')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      invoice_id: invoiceId,
      terminal_id: terminalId,
      reference,
      paystack_payment_request_id: pr.paymentRequestId,
      request_code: pr.requestCode ?? null,
      offline_reference: pr.offlineReference,
      amount: chargeAmount,
      status: 'pending',
      pushed_by: pushedBy,
      pushed_by_name: pushedByName,
      expires_at: new Date(Date.now() + CHARGE_TTL_MS).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single()

  if (insertError || !row) {
    return { ok: false, error: 'Could not record the charge. Please try again.' }
  }

  // 3. Push to the device.
  try {
    const push = await provider!.pushEventToTerminal!(terminalId, {
      paymentRequestId: pr.paymentRequestId,
      offlineReference: pr.offlineReference,
    })
    await supabase
      .from('terminal_payment_requests')
      .update({
        status: 'sent',
        event_id: push.eventId,
        delivered: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    // Best-effort delivery confirmation (does not change the 'sent' status; a
    // delivered=false just means "couldn't confirm reaching the device yet").
    if (push.eventId) {
      try {
        const st = await provider!.getTerminalEventStatus!(terminalId, push.eventId)
        if (st.delivered) {
          await supabase
            .from('terminal_payment_requests')
            .update({ delivered: true, updated_at: new Date().toISOString() })
            .eq('id', row.id)
        }
      } catch {
        // delivery check is informational only
      }
    }

    return { ok: true, requestId: row.id, status: 'sent', amount: chargeAmount }
  } catch (e: any) {
    await supabase
      .from('terminal_payment_requests')
      .update({
        status: 'failed',
        error_message: e?.message || 'Could not reach the terminal.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    return { ok: false, requestId: row.id, status: 'failed', error: 'Could not reach the terminal. Check it is on and online, then try again.' }
  }
}

export interface TerminalChargeStatus {
  id: string
  status: string
  delivered: boolean
  amount: number
  errorMessage: string | null
}

// Read a charge's live status (the modal polls this). School-scoped. Lazily
// expires a stale open row on read (the daily reconcile sweep is too coarse for
// a second viewer who'd otherwise see "sent" for hours) — a late webhook can
// still flip an expired row to paid, so this never loses a real payment.
export async function getTerminalChargeStatus(
  requestId: string,
  schoolId: string,
  supabase: any
): Promise<TerminalChargeStatus | null> {
  const { data: row } = await supabase
    .from('terminal_payment_requests')
    .select('id, status, delivered, amount, error_message, expires_at')
    .eq('id', requestId)
    .eq('school_id', schoolId)
    .maybeSingle()
  if (!row) return null

  let status = row.status
  if (
    (status === 'pending' || status === 'sent') &&
    row.expires_at &&
    new Date(row.expires_at).getTime() < Date.now()
  ) {
    const { data: updated } = await supabase
      .from('terminal_payment_requests')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('school_id', schoolId)
      .in('status', ['pending', 'sent']) // don't clobber a concurrent flip to paid
      .select('status')
      .maybeSingle()
    if (updated?.status) status = updated.status
  }

  return {
    id: row.id,
    status,
    delivered: row.delivered === true,
    amount: Number(row.amount) || 0,
    errorMessage: row.error_message ?? null,
  }
}

// Expire stale open charges (pending/sent past their TTL). Called by the
// reconcile cron so a device that never completed a charge doesn't leave a row
// stuck "waiting" forever. Returns how many were expired.
export async function expireStaleTerminalRequests(schoolId: string, supabase: any): Promise<number> {
  const { data } = await supabase
    .from('terminal_payment_requests')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('school_id', schoolId)
    .in('status', ['pending', 'sent'])
    .lt('expires_at', new Date().toISOString())
    .select('id')
  return (data || []).length
}
