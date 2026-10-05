'use server'

import { revalidatePath } from 'next/cache'
import { getPlatformAdmin } from '@/lib/auth'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Server action for the bank-transfer (DVA) fallback panel. The auto-debit
// mandate is the retention rail, so a school must not casually move itself onto
// manual bank transfer. This flag gates the self-serve DVA choice on
// /connect-billing in fees101-web and is off by default. Only Fees101 staff
// turn it on here, and only when a school's bank or card genuinely cannot hold
// an auto-debit mandate. The flag lives on platform_billing (service-role only),
// alongside the rest of the billing state.

async function requireAdmin() {
  const admin = await getPlatformAdmin()
  if (!admin) throw new Error('Not authenticated')
  return admin
}

export async function setDvaFallbackEnabled(
  schoolId: string,
  enabled: boolean,
  confirmed: boolean,
): Promise<{ success: true } | { error: string }> {
  try {
    // Enabling requires the staff member to confirm the school cannot hold an
    // auto-debit mandate. This is the real server-side gate; the client checkbox
    // only mirrors it. Disabling needs no confirmation.
    if (enabled && confirmed !== true) {
      return { error: 'Confirm the school cannot hold an auto-debit mandate before enabling bank transfer.' }
    }

    const admin = await requireAdmin()
    const supabase = createServiceRoleClient()

    const update = enabled
      ? {
          dva_fallback_enabled: true,
          dva_fallback_enabled_at: new Date().toISOString(),
          dva_fallback_enabled_by: admin.id,
        }
      : {
          dva_fallback_enabled: false,
          dva_fallback_enabled_at: null,
          dva_fallback_enabled_by: null,
        }

    const { error: updateError } = await supabase.from('platform_billing').update(update).eq('school_id', schoolId)
    if (updateError) return { error: updateError.message }

    await supabase.from('platform_audit_log').insert({
      actor_id: admin.id,
      actor_name: admin.name,
      action: enabled ? 'school.dva_fallback_enabled' : 'school.dva_fallback_disabled',
      school_id: schoolId,
      summary: enabled
        ? 'Enabled bank-transfer (DVA) fallback (school cannot hold an auto-debit mandate)'
        : 'Disabled bank-transfer (DVA) fallback',
      metadata: { schoolId },
    })

    revalidatePath(`/schools/${schoolId}`)
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update bank-transfer fallback.' }
  }
}
