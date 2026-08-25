import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface SiblingTier {
  // Either a % of the discountable subtotal or a flat Naira amount,
  // depending on isPercentage.
  value: number
  isPercentage: boolean
}

export interface DiscountSettings {
  schoolId: string
  // Discount for the 2nd, 3rd+ child in the same family, by index (index 0 =
  // 2nd child — the 1st/oldest child never gets a stored slot, always full
  // price). Index clamps for families larger than the configured tier list.
  // Schools choose both how many tiers to configure and whether each tier is
  // a % or a flat amount.
  siblingTiers: SiblingTier[]
  // Default % suggested when a bursar requests a staff-child discount —
  // still editable per-request, just saves re-typing the common case.
  staffDiscountDefaultPct: number
}

export const DEFAULT_DISCOUNT_SETTINGS: Omit<DiscountSettings, 'schoolId'> = {
  // Off by default — a school must opt into sibling discounts itself by
  // configuring tiers. No tiers = no auto-discount (computeSiblingDiscount
  // returns null on an empty list), so nothing is silently applied.
  siblingTiers: [],
  staffDiscountDefaultPct: 50,
}

async function getSchoolId() {
  const ctx = await getAuthContext()
  return ctx?.schoolId ?? null
}

export function mergeDiscountSettings(schoolId: string, stored: any): DiscountSettings {
  return { schoolId, ...DEFAULT_DISCOUNT_SETTINGS, ...(stored || {}) }
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
