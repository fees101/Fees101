// Platform DVA provisioning + transfer reconciliation.
//
// The collection rail for platform billing: each school gets one Fees101-owned
// Paystack Dedicated Virtual Account (DVA) that it transfers its monthly
// platform bill INTO (flat ₦300/transfer). Paystack fires a charge.success
// webhook when money lands, which we reconcile here against the school's open
// platform_billing_periods. All writes go through the service-role client
// (RLS is on with no policies — this is a founder-only backend).

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { createPlatformDVA } from '@/lib/paystack'

export interface ProvisionedDva {
  reference: string
  accountNumber: string
  bankName: string
  bankCode: string
}

// Idempotently provision the school's platform DVA. If one already exists
// (platform_dva_reference set) we return it untouched; otherwise we ensure a
// platform_billing row exists, call Paystack, persist the platform_dva_*
// columns, and log the action.
export async function provisionPlatformDvaForSchool(schoolId: string): Promise<ProvisionedDva> {
  const supabase = createServiceRoleClient()

  // Look up any existing billing row / DVA first — idempotency guard.
  const { data: existing } = await supabase
    .from('platform_billing')
    .select('school_id, platform_dva_reference, platform_dva_account_number, platform_dva_bank_name, platform_dva_bank_code')
    .eq('school_id', schoolId)
    .maybeSingle()

  if (existing?.platform_dva_reference) {
    return {
      reference: existing.platform_dva_reference,
      accountNumber: existing.platform_dva_account_number ?? '',
      bankName: existing.platform_dva_bank_name ?? '',
      bankCode: existing.platform_dva_bank_code ?? '',
    }
  }

  // Resolve the school's name for a friendlier Paystack customer record.
  const { data: school } = await supabase
    .from('schools')
    .select('id, name')
    .eq('id', schoolId)
    .maybeSingle()

  if (!school) throw new Error(`School ${schoolId} not found`)

  // Ensure a platform_billing row exists before we attach DVA details to it.
  if (!existing) {
    await supabase
      .from('platform_billing')
      .insert({ school_id: schoolId })
  }

  const dva = await createPlatformDVA({
    schoolId,
    schoolName: school.name ?? 'School',
  })

  const { error: updateErr } = await supabase
    .from('platform_billing')
    .update({
      platform_dva_reference: dva.reference,
      platform_dva_account_number: dva.accountNumber,
      platform_dva_bank_name: dva.bankName,
      platform_dva_bank_code: dva.bankCode,
      platform_dva_created_at: new Date().toISOString(),
    })
    .eq('school_id', schoolId)

  if (updateErr) throw new Error(`Failed to persist DVA: ${updateErr.message}`)

  await supabase.from('platform_audit_log').insert({
    actor_name: 'System',
    action: 'billing.platform_dva_provisioned',
    school_id: schoolId,
    summary: `Provisioned platform DVA ${dva.accountNumber} (${dva.bankName})`,
    metadata: {
      reference: dva.reference,
      accountNumber: dva.accountNumber,
      bankName: dva.bankName,
      bankCode: dva.bankCode,
    },
  })

  return dva
}

export interface ReconcileParams {
  customerCode: string
  amount: number // naira
  reference: string
  transactionId?: string | number | null
  paidAt?: string | null
}

export interface ReconcileResult {
  status: 'reconciled' | 'skipped_duplicate' | 'school_not_found'
  schoolId?: string
  appliedTo?: Array<{ periodId: string; applied: number }>
  overpayment?: number
}

// Reconcile an inbound DVA transfer against a school's outstanding platform
// bills. Called by the webhook once a charge.success is verified.
//
// Idempotency: we key on paystack_reference — Paystack can (and does) redeliver
// the same webhook, so if a charge row with this reference already exists we
// skip entirely rather than double-crediting.
//
// Period application order (DESIGN FLAG — oldest-open-first): the amount is
// applied to the school's open/partial/overdue/billed periods sorted by
// period_start ascending, so the oldest debt clears first.
//
// Overpayment (DESIGN FLAG): any amount left after every outstanding period is
// fully paid is added onto the newest period's amount_paid as a positive
// credit (amount_paid can exceed amount_due). It is NOT auto-refunded and is
// surfaced in the return value / audit log so it can be reviewed. If the
// school has no periods at all, the whole transfer is recorded as an
// unallocated overpayment (charge row still written for the audit trail).
export async function reconcilePlatformTransfer(params: ReconcileParams): Promise<ReconcileResult> {
  const supabase = createServiceRoleClient()
  const nowIso = new Date().toISOString()

  // 1. Map the DVA transfer back to a school via the customer_code.
  const { data: billing } = await supabase
    .from('platform_billing')
    .select('school_id, billing_connected_at, setup_fee_amount, onboarding_at')
    .eq('platform_dva_reference', params.customerCode)
    .maybeSingle()

  if (!billing) {
    return { status: 'school_not_found' }
  }
  const schoolId = billing.school_id as string

  // 2. Idempotency guard — bail if we've already booked this reference.
  const { data: dupe } = await supabase
    .from('platform_billing_charges')
    .select('id')
    .eq('paystack_reference', params.reference)
    .maybeSingle()

  if (dupe) {
    return { status: 'skipped_duplicate', schoolId }
  }

  // 2b. Not connected yet: this is the bank-transfer fallback's setup transfer
  // (see fees101-web's /connect-billing "use bank transfer instead"), not a
  // recurring bill payment. A transfer of at least the setup fee unlocks the
  // app the same way a successful mandate checkout does; anything smaller is
  // still recorded so it isn't lost, but the gate stays shut and the owner
  // needs to send the rest.
  if (!billing.billing_connected_at) {
    const required = Number(billing.setup_fee_amount) || 10000
    const nowIso = new Date().toISOString()

    const { error: chargeErr } = await supabase.from('platform_billing_charges').insert({
      school_id: schoolId,
      amount: params.amount,
      status: 'success',
      paystack_reference: params.reference,
      method: 'dva_transfer',
      charged_by: 'setup_fee',
      provider_transaction_id: params.transactionId != null ? String(params.transactionId) : null,
      paid_at: params.paidAt ?? nowIso,
    })
    if (chargeErr) throw new Error(`Failed to record charge: ${chargeErr.message}`)

    if (params.amount < required) {
      return { status: 'reconciled', schoolId, appliedTo: [], overpayment: 0 }
    }

    await supabase
      .from('platform_billing')
      .update({
        setup_fee_status: 'paid',
        setup_fee_paid_at: nowIso,
        billing_connected_at: nowIso,
        onboarding_at: billing.onboarding_at || nowIso,
        billing_status: 'active',
        billing_status_changed_at: nowIso,
        updated_at: nowIso,
      })
      .eq('school_id', schoolId)

    await supabase.from('platform_audit_log').insert({
      actor_name: 'System',
      action: 'billing.dva_setup_connected',
      school_id: schoolId,
      summary: `Connected billing via ₦${params.amount.toLocaleString()} bank transfer`,
      metadata: { reference: params.reference, amount: params.amount, method: 'dva_transfer' },
    })

    return { status: 'reconciled', schoolId, appliedTo: [], overpayment: Math.max(params.amount - required, 0) }
  }

  // 3. Pull outstanding periods, oldest first.
  const { data: periods } = await supabase
    .from('platform_billing_periods')
    .select('id, amount_due, amount_paid, status, period_start')
    .eq('school_id', schoolId)
    .in('status', ['open', 'billed', 'partial', 'overdue'])
    .order('period_start', { ascending: true })

  const appliedTo: Array<{ periodId: string; applied: number }> = []
  let remaining = params.amount

  const outstanding = periods ?? []
  for (const period of outstanding) {
    if (remaining <= 0) break
    const due = Number(period.amount_due) || 0
    const paid = Number(period.amount_paid) || 0
    const shortfall = Math.max(due - paid, 0)
    if (shortfall <= 0) continue

    const applied = Math.min(shortfall, remaining)
    const newPaid = paid + applied
    remaining -= applied

    await supabase
      .from('platform_billing_periods')
      .update({
        amount_paid: newPaid,
        status: newPaid >= due ? 'paid' : 'partial',
        updated_at: nowIso,
      })
      .eq('id', period.id)

    appliedTo.push({ periodId: period.id as string, applied })
  }

  // Overpayment handling: park any leftover on the newest outstanding period
  // (or, failing that, the newest period overall) as extra amount_paid.
  let overpayment = 0
  if (remaining > 0) {
    overpayment = remaining
    let target = outstanding.length ? outstanding[outstanding.length - 1] : null
    if (!target) {
      const { data: newest } = await supabase
        .from('platform_billing_periods')
        .select('id, amount_due, amount_paid, status, period_start')
        .eq('school_id', schoolId)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle()
      target = newest ?? null
    }
    if (target) {
      const paid = Number(target.amount_paid) || 0
      await supabase
        .from('platform_billing_periods')
        .update({ amount_paid: paid + remaining, updated_at: nowIso })
        .eq('id', target.id)
      appliedTo.push({ periodId: target.id as string, applied: remaining })
    }
    // If there is no period at all, the overpayment stays unallocated; the
    // charge row below still records the full amount for the audit trail.
    remaining = 0
  }

  // 4. Record the charge. Attribute it to the oldest period it touched (if any)
  //    for a rough period link; the full breakdown lives in the audit log.
  const primaryPeriodId = appliedTo.length ? appliedTo[0].periodId : null

  const { error: chargeErr } = await supabase
    .from('platform_billing_charges')
    .insert({
      school_id: schoolId,
      amount: params.amount,
      status: 'success',
      paystack_reference: params.reference,
      method: 'dva_transfer',
      period_id: primaryPeriodId,
      provider_transaction_id: params.transactionId != null ? String(params.transactionId) : null,
      paid_at: params.paidAt ?? nowIso,
    })

  if (chargeErr) throw new Error(`Failed to record charge: ${chargeErr.message}`)

  // 5. A successful transfer reactivates the school's billing.
  await supabase
    .from('platform_billing')
    .update({ billing_status: 'active', billing_status_changed_at: nowIso })
    .eq('school_id', schoolId)

  await supabase.from('platform_audit_log').insert({
    actor_name: 'System',
    action: 'billing.platform_transfer_reconciled',
    school_id: schoolId,
    summary: `Reconciled ₦${params.amount.toLocaleString()} DVA transfer` +
      (overpayment > 0 ? ` (₦${overpayment.toLocaleString()} overpayment parked)` : ''),
    metadata: {
      reference: params.reference,
      amount: params.amount,
      method: 'dva_transfer',
      appliedTo,
      overpayment,
      providerTransactionId: params.transactionId != null ? String(params.transactionId) : null,
    },
  })

  return { status: 'reconciled', schoolId, appliedTo, overpayment }
}
