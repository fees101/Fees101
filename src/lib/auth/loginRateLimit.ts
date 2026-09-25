import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendEmail } from '@/lib/messaging/sendMessage'
import { composeLockoutEmail } from '@/lib/messaging/composeInvite'

// Per-account login throttling (2026-09-16 stress test: 15 rapid wrong-
// password attempts against a known account all returned identical fast
// responses with no throttling, delay, or lockout). See db/login_attempts.sql
// for why this is keyed by email rather than IP.
const ATTEMPT_LIMIT = 5
const WINDOW_MINUTES = 15
const RETENTION_HOURS = 24

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function checkLoginRateLimit(
  email: string
): Promise<{ locked: boolean; retryAfterMinutes?: number }> {
  const svc = createServiceRoleClient()
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  const { data } = await svc
    .from('login_attempts')
    .select('created_at')
    .eq('email', normalizeEmail(email))
    .eq('success', false)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: true })

  const attempts = data || []
  if (attempts.length < ATTEMPT_LIMIT) return { locked: false }

  const oldestInWindow = new Date(attempts[0].created_at)
  const unlocksAt = new Date(oldestInWindow.getTime() + WINDOW_MINUTES * 60_000)
  const retryAfterMinutes = Math.max(1, Math.ceil((unlocksAt.getTime() - Date.now()) / 60_000))
  return { locked: true, retryAfterMinutes }
}

export async function recordLoginAttempt(email: string, success: boolean): Promise<void> {
  const svc = createServiceRoleClient()
  const normalized = normalizeEmail(email)

  if (success) {
    // A correct password clears the slate — the point is stopping someone
    // guessing, not penalizing the real account holder for earlier typos.
    await svc.from('login_attempts').delete().eq('email', normalized)
  } else {
    await svc.from('login_attempts').insert({ email: normalized, success: false })

    // checkLoginRateLimit() locks the account out once this email has 5
    // failures in the window; from that point on it short-circuits before
    // ever reaching signInWithPassword, so this insert branch only runs up
    // to exactly ATTEMPT_LIMIT times per window. Counting right after the
    // insert and firing only when the count *equals* the limit means this
    // notifies the owner exactly once per lockout, at the moment it happens.
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
    const { count } = await svc
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('email', normalized)
      .eq('success', false)
      .gte('created_at', windowStart)
    if (count === ATTEMPT_LIMIT) {
      await notifyOwnerOfLockout(svc, normalized).catch(() => {})
    }
  }

  // Opportunistic cleanup instead of a cron job — this table is low-volume
  // and only ever needs a rolling day of history.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60_000).toISOString()
    await svc.from('login_attempts').delete().lt('created_at', cutoff)
  }
}

// Best-effort — a failed send here must never surface as a failed login
// attempt. Not sent to the locked-out account itself (they're the one who
// might be a stranger guessing) — to the school owner, so they can tell a
// mistyped password from someone trying accounts one at a time. If the
// locked-out account IS the owner's own, this is the same inbox anyway.
async function notifyOwnerOfLockout(svc: ReturnType<typeof createServiceRoleClient>, normalizedEmail: string): Promise<void> {
  const { data: lockedUser } = await svc
    .from('users')
    .select('id, name, email, school_id')
    .ilike('email', normalizedEmail)
    .maybeSingle()
  // No matching account (e.g. an attacker guessing an email that isn't
  // registered here at all) — nothing real to notify anyone about.
  if (!lockedUser?.school_id) return

  const [{ data: school }, { data: owner }] = await Promise.all([
    svc.from('schools').select('name').eq('id', lockedUser.school_id).maybeSingle(),
    svc.from('users').select('email, name').eq('school_id', lockedUser.school_id).eq('role', 'school_admin').maybeSingle(),
  ])
  if (!owner?.email) return

  await sendEmail(
    { supabase: svc, schoolId: lockedUser.school_id, messageType: 'manual' as const },
    owner.email,
    composeLockoutEmail({
      schoolName: school?.name || 'your school',
      lockedAccountName: lockedUser.name || lockedUser.email,
      lockedAccountEmail: lockedUser.email,
      lockedAt: new Date().toISOString(),
    }),
  )
}
