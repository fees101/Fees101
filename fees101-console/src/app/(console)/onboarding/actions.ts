'use server'

import { getPlatformAdmin } from '@/lib/auth'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

async function requireAdmin() {
  const admin = await getPlatformAdmin()
  if (!admin) throw new Error('Not authenticated')
  return admin
}

interface CreateSchoolInput {
  schoolName: string
  ownerName: string
  ownerEmail: string
}

type CreateSchoolResult =
  | { error: string }
  | { success: true; schoolId: string; schoolName: string; ownerEmail: string; actionLink: string }

// Phase 0 of the self-onboarding flow (ROADMAP.md "Self-onboarding flow"):
// just the school row + the owner's login. Default roles (Administrator/
// Bursar) are seeded automatically by the schools_seed_default_roles DB
// trigger. Billing-cycle anchor, DVA provisioning and the guided setup
// checklist are deliberately out of scope here — they're either already
// self-serve in the school app, or belong to the platform-billing build
// that's still deferred.
export async function createSchool(input: CreateSchoolInput): Promise<CreateSchoolResult> {
  const admin = await requireAdmin()

  const schoolName = input.schoolName.trim()
  const ownerName = input.ownerName.trim()
  const ownerEmail = input.ownerEmail.trim().toLowerCase()

  if (!schoolName) return { error: 'School name is required' }
  if (!ownerName) return { error: 'Owner name is required' }
  if (!ownerEmail || !ownerEmail.includes('@')) return { error: 'A valid owner email is required' }

  const supabase = createServiceRoleClient()

  const { data: existingUser } = await supabase.from('users').select('id').ilike('email', ownerEmail).maybeSingle()
  if (existingUser) return { error: 'That email already has a Fees101 login. It can only belong to one school.' }

  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .insert({ name: schoolName })
    .select('id, name')
    .single()

  if (schoolError || !school) {
    return { error: schoolError?.message || 'Could not create the school.' }
  }

  const { data: adminRole } = await supabase
    .from('roles')
    .select('id')
    .eq('school_id', school.id)
    .eq('is_admin', true)
    .maybeSingle()

  // There's no email-sending infrastructure in this console app (Brevo lives
  // only in fees101-web). generateLink() creates the Supabase Auth user and
  // hands back the action link, which the founder copies and sends to the
  // owner by hand (email/WhatsApp) for now — see ROADMAP.md for the proper
  // automated welcome email this is standing in for.
  const schoolAppUrl = process.env.SCHOOL_APP_URL || 'http://localhost:3000'
  const redirectTo = `${schoolAppUrl}/auth/callback?next=${encodeURIComponent(`/set-password?email=${encodeURIComponent(ownerEmail)}`)}`

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email: ownerEmail,
    options: {
      redirectTo,
      data: { name: ownerName, school_name: school.name, role_name: 'Administrator', inviter_name: admin.name },
    },
  })

  if (inviteError || !inviteData?.user || !inviteData.properties?.action_link) {
    await supabase.from('schools').delete().eq('id', school.id)
    const msg = (inviteError?.message || '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { error: 'That email already has a Fees101 login. It can only belong to one school.' }
    }
    return { error: inviteError?.message || 'Could not create the invite.' }
  }

  const newUserId = inviteData.user.id

  const { error: insertError } = await supabase.from('users').insert({
    id: newUserId,
    school_id: school.id,
    name: ownerName,
    email: ownerEmail,
    role: 'school_admin',
    role_id: adminRole?.id || null,
    is_active: true,
  })

  if (insertError) {
    await supabase.auth.admin.deleteUser(newUserId)
    await supabase.from('schools').delete().eq('id', school.id)
    return { error: insertError.message }
  }

  await supabase.from('platform_audit_log').insert({
    actor_id: admin.id,
    actor_name: admin.name,
    action: 'school.onboarded',
    school_id: school.id,
    summary: `Created school "${school.name}" with owner ${ownerName} (${ownerEmail})`,
    metadata: { schoolName: school.name, ownerName, ownerEmail },
  })

  return {
    success: true as const,
    schoolId: school.id,
    schoolName: school.name,
    ownerEmail,
    actionLink: inviteData.properties.action_link,
  }
}
