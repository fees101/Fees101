// Maps a PostgREST / Postgres write error to a short, user-facing sentence so a
// raw database string -- most notably "new row violates row-level security
// policy ..." -- is never shown to a school user. A genuine error is still
// surfaced (just cleanly) and logged server-side, so nothing is swallowed.
type DbWriteError = { code?: string; message?: string } | null | undefined

export function friendlyWriteError(err: DbWriteError, fallback: string): string {
  const code = err?.code || ''
  const message = err?.message || ''
  // 42501 = insufficient_privilege: an RLS policy rejected the write.
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You do not have permission to do that.'
  }
  // Keep the real cause out of the UI but visible in the server logs.
  if (err) console.error('Database write failed:', err)
  return fallback
}
