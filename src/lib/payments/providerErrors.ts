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
