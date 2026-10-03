'use server'

import { revalidatePath } from 'next/cache'
import { getPlatformAdmin } from '@/lib/auth'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

// Server action for the manual-payment-entry panel. Manual payment entry is a
// per-school feature that is off by default. Only Fees101 staff flip it on
// here, and only after a signed liability agreement is in place with the
// school. The school also has to accept an in-app liability affirmation on the
// fees101-web side before the feature is usable, but that state is read-only
// here (see the panel) and is not required to set the flag.

async function requireAdmin() {
  const admin = await getPlatformAdmin()
  if (!admin) throw new Error('Not authenticated')
  return admin
}

export async function setManualPaymentEntryEnabled(
  schoolId: string,
  enabled: boolean,
  confirmed: boolean,
): Promise<{ success: true } | { error: string }> {
  try {
    // Enabling requires the staff member to confirm a signed liability agreement
    // is in place. This is the real server-side gate; the client checkbox only
    // mirrors it. Disabling needs no confirmation.
    if (enabled && confirmed !== true) {
      return { error: 'Confirm the signed liability agreement is in place before enabling.' }
    }

    const admin = await requireAdmin()
    const supabase = createServiceRoleClient()

    const update = enabled
      ? {
          manual_payment_entry_enabled: true,
          manual_payment_entry_enabled_at: new Date().toISOString(),
          manual_payment_entry_enabled_by: admin.id,
        }
      : {
          // Disabling also clears the owner's liability acceptance so that
          // re-enabling forces a fresh in-app re-affirmation on fees101-web
          // (a null/non-matching version there reads as "not accepted").
          manual_payment_entry_enabled: false,
          manual_payment_entry_enabled_at: null,
          manual_payment_entry_enabled_by: null,
          manual_payment_liability_version: null,
          manual_payment_liability_accepted_at: null,
          manual_payment_liability_accepted_by: null,
        }

    const { error: updateError } = await supabase.from('schools').update(update).eq('id', schoolId)
    if (updateError) return { error: updateError.message }

    await supabase.from('platform_audit_log').insert({
      actor_id: admin.id,
      actor_name: admin.name,
      action: enabled ? 'school.manual_payment_entry_enabled' : 'school.manual_payment_entry_disabled',
      school_id: schoolId,
      summary: enabled
        ? 'Enabled manual payment entry (liability agreement confirmed in place)'
        : 'Disabled manual payment entry',
      metadata: enabled ? { schoolId, liabilityAgreementConfirmed: confirmed } : { schoolId },
    })

    revalidatePath(`/schools/${schoolId}`)
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not update manual payment entry.' }
  }
}
