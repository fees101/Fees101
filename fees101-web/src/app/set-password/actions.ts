'use server'

import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendEmail } from '@/lib/messaging/sendMessage'
import { composeInviteExpiredEmail } from '@/lib/messaging/composeInvite'

// Called from the "this invite has expired" state on /set-password. The
// person landing here has no session (that's the whole problem), so there's
// no ctx.userId to key off — the invite email address, passed through the
// invite link's `next` query string (see team/users/actions.ts's
// addStaff/resendInvite), is the only identifier available at this point.
//
// Who to notify isn't stored on a dedicated "invited_by" column — it's
// recovered from the audit log's most recent staff.added/staff.invite_resent
// entry for this user (whoever most recently sent them an invite).
export async function notifyInviterOfExpiredLink(
  email: string,
): Promise<{ success: true; inviterName: string } | { error: string }> {
  const normalized = (email || '').trim().toLowerCase()
  if (!normalized) return { error: 'Missing invite details.' }

  const svc = createServiceRoleClient()

  const { data: invitee } = await svc
    .from('users')
    .select('id, name, email, school_id')
    .ilike('email', normalized)
    .maybeSingle()
  if (!invitee) {
    return { error: "Couldn't find that invite. Ask your school administrator for a new one." }
  }

  const { data: inviteEvent } = await svc
    .from('audit_log')
    .select('actor_id, actor_name')
    .eq('target_type', 'user')
    .eq('target_id', invitee.id)
    .in('action', ['staff.added', 'staff.invite_resent'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!inviteEvent?.actor_id) {
    return { error: "Couldn't find who invited you. Ask your school administrator for a new invite." }
  }

  const [{ data: school }, { data: inviter }] = await Promise.all([
    svc.from('schools').select('name').eq('id', invitee.school_id).maybeSingle(),
    svc.from('users').select('email, name').eq('id', inviteEvent.actor_id).maybeSingle(),
  ])

  const inviterName = inviteEvent.actor_name || inviter?.name || 'Someone at your school'

  // In-app notification of record — same table/shape as every other admin
  // notification (staff_added, role_changed, etc).
  await svc.from('admin_notifications').insert({
    school_id: invitee.school_id,
    type: 'invite_expired',
    title: `${invitee.name || invitee.email}'s invite expired`,
    body: `${invitee.name || invitee.email} (${invitee.email}) tried to set up their login, but the invite link had expired. Resend it from Settings → Users.`,
  })

  // Best-effort email alongside it — never let a delivery failure block the
  // in-app notification above, which is already the notification of record.
  if (inviter?.email) {
    try {
      await sendEmail(
        { supabase: svc, schoolId: invitee.school_id, messageType: 'manual' as const },
        inviter.email,
        composeInviteExpiredEmail({
          schoolName: school?.name || 'your school',
          inviteeName: invitee.name || invitee.email,
          inviteeEmail: invitee.email,
        }),
      )
    } catch {
      // ignore — the in-app notification already landed
    }
  }

  return { success: true, inviterName }
}
