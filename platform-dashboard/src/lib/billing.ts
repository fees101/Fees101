import { createServiceRoleClient } from './supabase/serviceRole'
import { chargeAuthorization } from './paystack'

// Suspension ladder day-counts — the exact numbers are a business call, not
// a technical one (flagged in ROADMAP research as "only the owner can make
// this call"). These are placeholder defaults so the mechanism is complete
// and testable now; change them here once you've decided, no schema change
// needed.
const GRACE_PERIOD_DAYS = 7 // active -> payment_due -> (this many days) -> grace
const SUSPEND_AFTER_GRACE_DAYS = 7 // grace -> (this many more days) -> suspended

export function getPerTermAmount(annualPrice: number, termsPerYear: number): number {
  if (termsPerYear <= 0) return 0
  return Math.round((annualPrice / termsPerYear) * 100) / 100
}

// Walks a school's billing_status forward based on how overdue
// next_charge_due_at is. Called from the cron-checkable API route below, or
// can be invoked ad hoc per school from the dashboard. Only ever moves the
// ladder based on elapsed time — never charges anything itself (charging is
// a separate explicit action, chargeSchoolForTerm below).
export async function evaluateSuspensionLadder(schoolId: string): Promise<{ from: string; to: string } | null> {
  const supabase = createServiceRoleClient()
  const { data: billing } = await supabase
    .from('platform_billing')
    .select('billing_status, next_charge_due_at, billing_status_changed_at')
    .eq('school_id', schoolId)
    .maybeSingle()

  if (!billing || !billing.next_charge_due_at) return null
  if (billing.billing_status === 'cancelled') return null

  const now = Date.now()
  const dueAt = new Date(billing.next_charge_due_at).getTime()
  const daysOverdue = (now - dueAt) / (1000 * 60 * 60 * 24)

  let nextStatus = billing.billing_status
  if (daysOverdue <= 0) nextStatus = 'active'
  else if (daysOverdue <= GRACE_PERIOD_DAYS) nextStatus = 'payment_due'
  else if (daysOverdue <= GRACE_PERIOD_DAYS + SUSPEND_AFTER_GRACE_DAYS) nextStatus = 'grace'
  else nextStatus = 'suspended'

  if (nextStatus === billing.billing_status) return null

  await supabase
    .from('platform_billing')
    .update({ billing_status: nextStatus, billing_status_changed_at: new Date().toISOString() })
    .eq('school_id', schoolId)

  await supabase.from('platform_audit_log').insert({
    actor_name: 'System',
    action: 'billing.status_changed',
    school_id: schoolId,
    summary: `Billing status moved from ${billing.billing_status} to ${nextStatus} (${Math.floor(daysOverdue)} days overdue)`,
    metadata: { from: billing.billing_status, to: nextStatus, daysOverdue: Math.floor(daysOverdue) },
  })

  return { from: billing.billing_status, to: nextStatus }
}

export async function chargeSchoolForTerm(
  schoolId: string,
  actorName: string
): Promise<{ success: true; reference: string } | { error: string }> {
  const supabase = createServiceRoleClient()

  const [{ data: billing }, { data: school }] = await Promise.all([
    supabase.from('platform_billing').select('*').eq('school_id', schoolId).single(),
    supabase.from('schools').select('name, terms_per_year').eq('id', schoolId).single(),
  ])

  if (!billing) return { error: 'No platform_billing row for this school — set an annual price first.' }
  if (!billing.paystack_authorization_code) return { error: 'No saved card on file for this school yet.' }

  const amount = getPerTermAmount(Number(billing.annual_price), school?.terms_per_year || 3)
  if (amount <= 0) return { error: 'Computed charge amount is ₦0 — set an annual price first.' }

  const reference = `platform_${schoolId}_${Date.now()}`

  const { data: chargeRow } = await supabase
    .from('platform_billing_charges')
    .insert({ school_id: schoolId, amount, status: 'pending', paystack_reference: reference, charged_by: actorName })
    .select('id')
    .single()

  try {
    const result = await chargeAuthorization({
      authorizationCode: billing.paystack_authorization_code,
      email: billing.paystack_email,
      amountNaira: amount,
      reference,
    })

    const success = result.status === 'success'
    await supabase
      .from('platform_billing_charges')
      .update({ status: success ? 'success' : 'failed', failure_reason: success ? null : result.gateway_response })
      .eq('id', chargeRow!.id)

    if (success) {
      const nextDue = new Date()
      nextDue.setMonth(nextDue.getMonth() + Math.round(12 / (school?.terms_per_year || 3)))
      await supabase
        .from('platform_billing')
        .update({
          billing_status: 'active',
          billing_status_changed_at: new Date().toISOString(),
          last_charged_at: new Date().toISOString(),
          last_charge_amount: amount,
          last_charge_reference: reference,
          next_charge_due_at: nextDue.toISOString(),
        })
        .eq('school_id', schoolId)
    }

    await supabase.from('platform_audit_log').insert({
      actor_name: actorName,
      action: success ? 'billing.charge_succeeded' : 'billing.charge_failed',
      school_id: schoolId,
      summary: `${success ? 'Charged' : 'Failed to charge'} ₦${amount.toLocaleString()} for a term`,
      metadata: { amount, reference, gatewayResponse: result.gateway_response },
    })

    if (!success) return { error: result.gateway_response }
    return { success: true, reference }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Charge failed'
    await supabase.from('platform_billing_charges').update({ status: 'failed', failure_reason: message }).eq('id', chargeRow!.id)
    return { error: message }
  }
}
