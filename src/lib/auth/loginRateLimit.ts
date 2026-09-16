import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

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
  }

  // Opportunistic cleanup instead of a cron job — this table is low-volume
  // and only ever needs a rolling day of history.
  if (Math.random() < 0.02) {
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60_000).toISOString()
    await svc.from('login_attempts').delete().lt('created_at', cutoff)
  }
}
