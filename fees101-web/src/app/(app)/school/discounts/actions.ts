'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import type { SiblingTier, DiscountApproval, ApproverRole } from '@/lib/queries/discounts'
import { logAuditEvent } from '@/lib/audit/logAudit'

const VALID_APPROVER_ROLES: ApproverRole[] = ['school_admin', 'bursar']

async function getContext() {
  // Gated on the 'manage-discount-config' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-discount-config')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

export async function saveDiscountSettings(form: {
  siblingTiers: SiblingTier[]
  staffDiscountDefaultPct: number
  staffDiscountScope: 'discountable_only' | 'full_invoice'
  approval: DiscountApproval
  reason?: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (form.siblingTiers.some(t =>
    !Number.isFinite(t.value) || t.value < 0 || (t.isPercentage && t.value > 100)
  )) {
    return { error: 'Sibling discount tiers must be a percentage (0–100) or a non-negative amount' }
  }
  if (!Number.isFinite(form.staffDiscountDefaultPct) || form.staffDiscountDefaultPct < 0 || form.staffDiscountDefaultPct > 100) {
    return { error: 'Staff discount default must be a percentage between 0 and 100' }
  }
  if (form.staffDiscountScope !== 'discountable_only' && form.staffDiscountScope !== 'full_invoice') {
    return { error: 'Invalid staff discount scope' }
  }

  // Approval config. Owner (school_admin) always qualifies, so force it in
  // regardless of what the client sent, and drop anything unrecognised.
  const approverRoles = Array.from(new Set<ApproverRole>([
    'school_admin',
    ...form.approval.approverRoles.filter(r => VALID_APPROVER_ROLES.includes(r)),
  ]))
  const threshold = form.approval.thresholdNaira
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) {
    return { error: 'Approval threshold must be a non-negative amount' }
  }
  const approval: DiscountApproval = {
    approverRoles,
    thresholdNaira: threshold === null ? null : Math.round(threshold),
  }

  const { data: existing } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  const before = (existing?.settings || {}).discounts || null
  const after = {
    siblingTiers: form.siblingTiers,
    staffDiscountDefaultPct: form.staffDiscountDefaultPct,
    staffDiscountScope: form.staffDiscountScope,
    approval,
  }

  const nextSettings = {
    ...(existing?.settings || {}),
    discounts: after,
  }

  const { error } = await supabase
    .from('schools')
    .update({ settings: nextSettings })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'discount_config.updated',
    targetType: 'school',
    targetId: schoolId,
    summary: 'Updated discount settings',
    metadata: { before, after, ...(form.reason?.trim() ? { reason: form.reason.trim() } : {}) },
  })

  revalidatePath('/school/discounts')
  return { success: true }
}
