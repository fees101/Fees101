// Platform-billing constants and the entry-gate check. Kept separate from the
// Paystack client so the gate (read by the app layout on every load) doesn't
// pull in the HTTP client, and so the business numbers live in one place.

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// One-time, nonrefundable setup fee in naira. Overridable via env so the owner
// can test the real flow against sandbox with a tiny amount before go-live
// without a code change. Defaults to the agreed ₦10,000.
export function setupFeeNaira(): number {
  const raw = Number(process.env.PLATFORM_SETUP_FEE_NAIRA)
  return Number.isFinite(raw) && raw > 0 ? raw : 10000
}

// Free days before recurring billing starts, measured from billing connection
// (onboarding_at). The accrual engine marks days inside this window billable=
// false. Agreed value: 65.
export const FREE_DAYS = 65

// Monthly price per active student (naira). Mirrors the default on
// platform_billing.price_per_student_month; used for display copy on the
// connect-billing screen. The accrual engine reads the column, not this.
export const PRICE_PER_STUDENT_MONTH = 500

// Bump when the billing terms text changes; stored per acceptance so we know
// which version a school agreed to.
export const BILLING_TERMS_VERSION = '2026-10-01'

// Small token charge used when an already-connected school switches from DVA
// back to a direct-debit mandate. Paystack's bank/recurring channel only
// creates a reusable authorization off a real successful transaction, so a
// nominal charge (not the one-time setup fee, which is never repeated) is
// needed to re-establish the mandate. Overridable via env for sandbox testing.
export function mandateSwitchChargeNaira(): number {
  const raw = Number(process.env.PLATFORM_MANDATE_SWITCH_CHARGE_NAIRA)
  // ₦50 matches the amount fees101-console's card-capture flow already uses
  // successfully (paystack.ts: "Paystack does not reliably tokenize a ₦0
  // charge") — the lowest amount confirmed to work in this codebase.
  return Number.isFinite(raw) && raw > 0 ? raw : 50
}

export type BillingGateState = {
  // True once the setup fee is paid — the school may enter the app.
  connected: boolean
  // True once the dunning ladder has walked the school all the way to
  // 'suspended' — the app layout hard-blocks entry to /account-suspended.
  suspended: boolean
  billingMethod: 'mandate' | 'dva'
  dvaAccountNumber: string | null
  dvaBankName: string | null
}

// Cheap PK lookup (platform_billing.school_id is the primary key). A missing
// row, or a row whose billing_connected_at is null, means billing isn't
// connected yet -> the app layout bounces to /connect-billing. Existing schools
// were grandfathered by the migration, so only new onboardings gate.
//
// MUST use the service-role client: platform_billing has RLS on with no
// policies (service-role only), so a user-scoped client reads zero rows for
// every school and the gate would always fire -> redirect loop against the
// connect-billing page (which reads the same table with service role).
export async function getBillingGateState(
  schoolId: string,
): Promise<BillingGateState> {
  const svc = createServiceRoleClient()
  const { data } = await svc
    .from('platform_billing')
    .select('billing_connected_at, billing_status, billing_method, platform_dva_account_number, platform_dva_bank_name')
    .eq('school_id', schoolId)
    .maybeSingle()
  return {
    connected: !!data?.billing_connected_at,
    suspended: data?.billing_status === 'suspended',
    billingMethod: data?.billing_method === 'dva' ? 'dva' : 'mandate',
    dvaAccountNumber: data?.platform_dva_account_number || null,
    dvaBankName: data?.platform_dva_bank_name || null,
  }
}
