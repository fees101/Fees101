import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface SiblingTier {
  // Either a % of the discountable subtotal or a flat Naira amount,
  // depending on isPercentage.
  value: number
  isPercentage: boolean
}

// The role a school approver is drawn from. Owner (school_admin) always
// qualifies; bursar is opt-in. (Enforcement lands with the roles milestone;
// this is the config surface that milestone will read.)
export type ApproverRole = 'school_admin' | 'bursar'

export interface DiscountApproval {
  // Roles allowed to grant a discount. Always contains 'school_admin' (Owner).
  approverRoles: ApproverRole[]
  // Naira amount at/below which a discount is auto-approved the instant it's
  // requested — no approve click needed (see claimAndApplyDiscount, called
  // from requestDiscount). null = no threshold, every discount waits for a
  // human holding the approve-discounts permission. An auto-approved
  // discount can still be reviewed and revoked afterwards from /discounts.
  thresholdNaira: number | null
}

export interface DiscountSettings {
  schoolId: string
  // Discount for the 2nd, 3rd+ child in the same family, by index (index 0 =
  // 2nd child — the 1st/oldest child never gets a stored slot, always full
  // price). Index clamps for families larger than the configured tier list.
  // Schools choose both how many tiers to configure and whether each tier is
  // a % or a flat amount.
  siblingTiers: SiblingTier[]
  // The fixed % applied to every staff-child discount request — this is the
  // actual rate used, not a suggestion a requester can override (there is no
  // more free-input at request time).
  staffDiscountDefaultPct: number
  // Whether a staff-child discount reduces the full invoice subtotal or only
  // the discountable-fee subset. Every other category (including sibling)
  // always uses the discountable subset — this is staff-child-only.
  staffDiscountScope: 'discountable_only' | 'full_invoice'
  // Who may approve manual discounts, and the escalation rules around them.
  approval: DiscountApproval
}

export const DEFAULT_DISCOUNT_APPROVAL: DiscountApproval = {
  // Owner alone by default; a school adds Bursar itself.
  approverRoles: ['school_admin'],
  thresholdNaira: null,
}

export const DEFAULT_DISCOUNT_SETTINGS: Omit<DiscountSettings, 'schoolId'> = {
  // Off by default — a school must opt into sibling discounts itself by
  // configuring tiers. No tiers = no auto-discount (computeSiblingDiscount
  // returns null on an empty list), so nothing is silently applied.
  siblingTiers: [],
  staffDiscountDefaultPct: 25,
  staffDiscountScope: 'full_invoice',
  approval: DEFAULT_DISCOUNT_APPROVAL,
}

async function getSchoolId() {
  const ctx = await getAuthContext()
  return ctx?.schoolId ?? null
}

export function mergeDiscountSettings(schoolId: string, stored: any): DiscountSettings {
  const s = stored || {}

  return {
    schoolId,
    siblingTiers: s.siblingTiers ?? DEFAULT_DISCOUNT_SETTINGS.siblingTiers,
    staffDiscountDefaultPct: s.staffDiscountDefaultPct ?? DEFAULT_DISCOUNT_SETTINGS.staffDiscountDefaultPct,
    // Missing/unrecognised value on an old school's saved blob falls back to
    // 'full_invoice' — the current default for a school that hasn't touched
    // this setting (see DEFAULT_DISCOUNT_SETTINGS above).
    staffDiscountScope: s.staffDiscountScope === 'discountable_only' ? 'discountable_only' : 'full_invoice',
    // Deep-merge so a school that saved settings before the approval block
    // existed still gets sensible approval defaults filled in.
    approval: { ...DEFAULT_DISCOUNT_APPROVAL, ...(s.approval || {}) },
  }
}

export async function getDiscountSettings(): Promise<DiscountSettings | null> {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return null

  const { data: school } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  if (!school) return null

  return mergeDiscountSettings(schoolId, school.settings?.discounts)
}

// Same merge, but for use inside server actions/compute that already hold a
// supabase client + schoolId — avoids re-deriving schoolId from the session.
export async function getDiscountSettingsFor(supabase: any, schoolId: string): Promise<DiscountSettings> {
  const { data: school } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  return mergeDiscountSettings(schoolId, school?.settings?.discounts)
}
