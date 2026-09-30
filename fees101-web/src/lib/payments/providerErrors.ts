// Distinguishes a provider actually being unreachable (network failure,
// timeout, DNS, TLS) from the provider responding but rejecting the request
// (bad credentials, validation) — the two throw sites above (monnify.ts,
// paystack.ts) only ever hand-throw an Error for the second case, so
// anything else reaching here is a real outage, not a rejection. Per Auth &
// Edges.dc.html's PROVIDER DOWN state: "Payments already made are safe...
// What is blocked: creating new payment accounts. Says which, so nobody
// assumes money was lost" — never a raw fetch/SDK error string, which reads
// like the app itself broke rather than a remote outage.
export function isProviderDownError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // Node's global fetch throws exactly this message for every network-level
  // failure; the real reason (ECONNREFUSED/ETIMEDOUT/ENOTFOUND/ECONNRESET)
  // sits on `.cause`, which a hand-thrown `new Error('Monnify ... failed')`
  // never has.
  if (err.message === 'fetch failed') return true
  const cause = (err as { cause?: unknown }).cause
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: string }).code
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return true
    }
  }
  return false
}

// A provider throttling us (HTTP 429 / "Rate limit exceeded") is NOT the same
// as a real failure or an outage — the request would succeed if retried once
// the window resets. Bulk loops treat this like isProviderDownError: pause and
// leave the untried items for the next run, rather than marking them failed and
// crossing them off (which permanently burns them). The provider transports
// (paystack.ts / monnify.ts) already retry a 429 a few times via
// fetchWithRateLimitRetry; this catches the case where it's *still* limiting
// after those retries, which surfaces as a thrown Error carrying the message.
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return m.includes('rate limit') || m.includes('too many request') || m.includes(' 429')
}

const PROVIDER_LABELS: Record<string, string> = {
  monnify: 'Monnify',
  paystack: 'Paystack',
}

export function providerDisplayName(provider: string | null | undefined): string {
  return (provider && PROVIDER_LABELS[provider]) || 'Your payment provider'
}

export function providerDownMessage(provider: string | null | undefined): string {
  const name = providerDisplayName(provider)
  return `${name} is not responding right now. Payments already made are safe and will reconcile once the connection returns — only creating new payment accounts is blocked. Try again shortly.`
}

export function rateLimitMessage(provider: string | null | undefined): string {
  const name = providerDisplayName(provider)
  return `${name} is temporarily limiting how fast new payment accounts can be created. The remaining accounts will keep provisioning automatically in the background — nothing was lost.`
}
