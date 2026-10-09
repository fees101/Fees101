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

// Bump when the manual-payment liability affirmation text changes. The school
// owner must accept the current version before manual payment entry unlocks for
// the school; the accepted version is stamped on schools.manual_payment_
// liability_version so a text change re-prompts for a fresh acceptance.
export const MANUAL_PAYMENT_LIABILITY_VERSION = '2026-10-03'

// Same mechanism, for refunding a real (Paystack) payment — real-money
// clawback risk, same two-sided gate (console-enabled + owner-accepted).
export const REFUNDS_LIABILITY_VERSION = '2026-10-07'

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

// Where a stuck owner is sent for help on the connect-billing screen. Support
// can manually flip platform_billing.dva_fallback_enabled from the console, which
// unlocks the bank-transfer option for that school on their next load.
export const SUPPORT_EMAIL = 'support@fees101.com'

// How many TRANSIENT mandate failures (declined card, insufficient funds, a
// network timeout — things a retry might fix) we let an owner hit before the
// self-serve bank-transfer fallback opens on its own. A HARD failure (the bank
// doesn't support direct debit, or the checkout was abandoned) opens transfer
// immediately and doesn't wait for this count. Kept low (2) so a genuinely stuck
// owner isn't frustrated into a third dead-end attempt; the auto-debit mandate
// still stays the primary, pushed path for a first recoverable blip.
export const MANDATE_SOFT_FAIL_THRESHOLD = 2

// The banks that currently support Paystack Direct Debit, shown as a "these work
// with automatic debit" hint when an owner's mandate won't go through. Paystack's
// supported-bank list is short and changes over time, and most big banks aren't
// on it yet, so this is NOT hardcoded — set PLATFORM_DIRECT_DEBIT_BANKS in env
// (comma-separated, e.g. "Kuda,Sterling Bank,Wema Bank") and keep it in sync with
// the Paystack dashboard. Empty by default, in which case the hint is omitted
// rather than showing a guessed (possibly wrong) list.
export function directDebitSupportedBanks(): string[] {
  const raw = process.env.PLATFORM_DIRECT_DEBIT_BANKS
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

// Classify a non-success setup-fee outcome so the connect flow can react
// differently to "this bank can never do direct debit" vs "that one payment
// bounced, try again". HARD = open the bank-transfer fallback now; SOFT = count
// it toward MANDATE_SOFT_FAIL_THRESHOLD and keep the mandate as the primary path.
//   - 'abandoned': the owner couldn't/didn't complete the checkout — most often
//     their bank wasn't in the direct-debit list to pick. Treat as HARD.
//   - a gateway_response naming the mandate / direct debit / bank support as the
//     blocker: HARD.
//   - anything else (declined, insufficient funds, timeout): SOFT.
export function classifyMandateFailure(
  status: string,
  gatewayResponse: string | null | undefined,
): 'hard' | 'soft' {
  if (status === 'abandoned') return 'hard'
  const r = (gatewayResponse || '').toLowerCase()
  const hardSignals = [
    'not support',
    'unsupported',
    'not enabled',
    'not available',
    'not eligible',
    'no mandate',
    'mandate',
    'direct debit',
  ]
  if (hardSignals.some((s) => r.includes(s))) return 'hard'
  return 'soft'
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
