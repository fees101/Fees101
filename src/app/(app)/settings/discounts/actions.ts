'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import type { SiblingTier } from '@/lib/queries/discounts'

async function getContext() {
  // Gated on the 'manage-discount-config' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-discount-config')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId }
}

export async function saveDiscountSettings(form: {
  siblingTiers: SiblingTier[]
  staffDiscountDefaultPct: number
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  if (form.siblingTiers.some(t =>
    !Number.isFinite(t.value) || t.value < 0 || (t.isPercentage && t.value > 100)
  )) {
    return { error: 'Sibling discount tiers must be a percentage (0–100) or a non-negative amount' }
  }
  if (!Number.isFinite(form.staffDiscountDefaultPct) || form.staffDiscountDefaultPct < 0 || form.staffDiscountDefaultPct > 100) {
    return { error: 'Staff discount default must be a percentage between 0 and 100' }
  }

  const { data: existing } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  const nextSettings = {
    ...(existing?.settings || {}),
    discounts: {
      siblingTiers: form.siblingTiers,
      staffDiscountDefaultPct: form.staffDiscountDefaultPct,
    },
  }

  const { error } = await supabase
    .from('schools')
    .update({ settings: nextSettings })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/settings/discounts')
  return { success: true }
}
