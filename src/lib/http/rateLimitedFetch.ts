// Server-side fetch wrapper that transparently retries on HTTP 429 (rate
// limited). Every outbound provider call (Paystack, Monnify, Sendchamp, Brevo)
// goes through this so a short throttling burst is ridden out automatically
// instead of surfacing as a hard failure.
//
// It honours the server's own guidance — `Retry-After` / `x-ratelimit-reset`
// (both expressed in seconds) — but caps the wait so a serverless request never
// blocks longer than `maxWaitMs`. If the endpoint is still limiting after
// `maxRetries`, the final 429 Response is returned as-is so the caller can turn
// it into a recognisable rate-limit error (see isRateLimitError) and pause the
// wider batch rather than burning through the rest of it.

interface RateLimitRetryOpts {
  maxRetries?: number
  maxWaitMs?: number
}

export async function fetchWithRateLimitRetry(
  url: string,
  init?: RequestInit,
  opts?: RateLimitRetryOpts
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 3
  const maxWaitMs = opts?.maxWaitMs ?? 8000

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(url, init)
    if (res.status !== 429 || attempt >= maxRetries) return res

    // Prefer the server's stated reset window; fall back to exponential backoff.
    // The un-read 429 body is discarded here — we only ever retry a fresh call.
    const resetSec = Number(res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset') || 0)
    const backoffMs = 500 * 2 ** attempt
    const waitMs = Math.min(Math.max(resetSec * 1000, backoffMs), maxWaitMs)
    await new Promise((r) => setTimeout(r, waitMs))
    attempt++
  }
}
