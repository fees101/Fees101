// Platform billing via Paystack, using the "save card once, charge many
// times for variable amounts" pattern (charge_authorization) rather than
// Paystack Subscriptions. Subscriptions assume a fixed price and a fixed
// interval set up front; per-term billing here has to move with a school's
// own terms_per_year and any future per-student pricing, so this app decides
// each charge's amount and timing itself and just asks Paystack to run it
// against a previously-captured card.
//
// This is the PLATFORM's own Paystack account (Fees101 charging schools),
// entirely separate from a school's own Paystack/Monnify credentials stored
// per-school in the schools-facing app (that's for collecting parent
// payments, a different merchant account and a different flow).

import crypto from 'node:crypto'

const PAYSTACK_BASE = 'https://api.paystack.co'

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error('Missing PAYSTACK_SECRET_KEY')
  return key
}

// Paystack's test secret keys start with 'sk_test'. In test mode the only
// dedicated-account bank Paystack will provision is the sentinel 'test-bank';
// in live mode we use Wema (the default DVA provider on the platform account).
function preferredBank(): string {
  return secretKey().startsWith('sk_test') ? 'test-bank' : 'wema-bank'
}

async function paystackFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = await res.json()
  if (!res.ok || body.status === false) {
    throw new Error(body.message || `Paystack request failed (${res.status})`)
  }
  return body
}

// Step 1 of capturing a school's card: initialize a transaction and send the
// school's billing contact to Paystack's hosted checkout. We charge a real
// small amount here (not ₦0 — Paystack does not reliably tokenize a ₦0
// charge) and immediately refund it; the authorization_code returned on
// verify is what matters, not this specific transaction. Amount is in kobo.
export async function initializeCardCapture(params: {
  email: string
  callbackUrl: string
  reference: string
}) {
  const CAPTURE_AMOUNT_KOBO = 5000 // ₦50 — refunded once the card is captured
  const body = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: CAPTURE_AMOUNT_KOBO,
      reference: params.reference,
      callback_url: params.callbackUrl,
      channels: ['card'],
    }),
  })
  return body.data as { authorization_url: string; access_code: string; reference: string }
}

// Step 2: after Paystack redirects back, verify the transaction and pull the
// reusable authorization_code + customer_code out of it.
export async function verifyTransaction(reference: string) {
  const body = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  return body.data as {
    status: string
    amount: number
    customer: { customer_code: string; email: string }
    authorization: { authorization_code: string; reusable: boolean; last4: string; card_type: string; bank: string }
  }
}

// Refunds the capture-amount charge from initializeCardCapture — the
// authorization_code survives a refund, so the school never actually pays
// the ₦50, it's purely a tokenization mechanism.
export async function refundTransaction(reference: string) {
  await paystackFetch('/refund', {
    method: 'POST',
    body: JSON.stringify({ transaction: reference }),
  })
}

// The actual recurring billing charge — amount in naira (converted to kobo
// here so callers stay in the same unit as the rest of the app).
export async function chargeAuthorization(params: {
  authorizationCode: string
  email: string
  amountNaira: number
  reference: string
}) {
  const body = await paystackFetch('/transaction/charge_authorization', {
    method: 'POST',
    body: JSON.stringify({
      authorization_code: params.authorizationCode,
      email: params.email,
      amount: Math.round(params.amountNaira * 100),
      reference: params.reference,
    }),
  })
  return body.data as { status: string; reference: string; gateway_response: string }
}

// Deactivates a saved authorization at Paystack so it can no longer be
// charged — used when a school's mandate needs to be cancelled immediately
// (e.g. the school is leaving) rather than waiting on the recurring-debit
// cron to notice a failure.
export async function deactivateMandate(authorizationCode: string) {
  await paystackFetch('/customer/authorization/deactivate', {
    method: 'POST',
    body: JSON.stringify({ authorization_code: authorizationCode }),
  })
}

// --- Platform DVA (school-pays-into) collection ---------------------------
//
// A Fees101-owned Dedicated Virtual Account per school: the school transfers
// its monthly platform bill INTO this account, and Paystack fires a
// charge.success webhook we reconcile against the school's billing periods.
// This is a flat ₦300/transfer rail, cheaper than the 1%-capped-₦2000 card
// path, and needs no saved authorization.

// Like paystackFetch but with a small, bounded retry on HTTP 429 so a burst
// of provisioning calls doesn't fail hard. Honors Retry-After /
// x-ratelimit-reset when present, otherwise backs off, and caps total waiting
// at a few seconds. Kept local (not applied to the card-capture calls above)
// so existing behavior is unchanged.
async function paystackFetchWithRetry(path: string, init?: RequestInit, maxRetries = 3) {
  const MAX_WAIT_MS = 4000
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = res.headers.get('retry-after')
      const rateReset = res.headers.get('x-ratelimit-reset')
      let waitMs = 500 * (attempt + 1) // default linear backoff
      if (retryAfter) waitMs = Math.max(waitMs, Number(retryAfter) * 1000)
      else if (rateReset) waitMs = Math.max(waitMs, Number(rateReset) * 1000)
      waitMs = Math.min(waitMs, MAX_WAIT_MS)
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }

    const body = await res.json()
    if (!res.ok || body.status === false) {
      throw new Error(body.message || `Paystack request failed (${res.status})`)
    }
    return body
  }
}

// Provision (or return the existing) Fees101-owned DVA for a school. The
// Paystack customer is keyed on a synthetic per-school email so the /customer
// call is idempotent — calling it again for the same school returns the same
// customer_code rather than creating a duplicate. The returned `reference` is
// that customer_code (stored as platform_dva_reference), which is also how the
// webhook maps an incoming transfer back to a school.
export async function createPlatformDVA(params: {
  schoolId: string
  schoolName: string
  email?: string
}): Promise<{ reference: string; accountNumber: string; bankName: string; bankCode: string }> {
  const email = params.email || `platform-school-${params.schoolId}@fees101.internal`

  // 1. Create/fetch the customer (idempotent per email).
  const customerRes = await paystackFetchWithRetry('/customer', {
    method: 'POST',
    body: JSON.stringify({
      email,
      first_name: 'Fees101',
      last_name: params.schoolName,
      metadata: { school_id: params.schoolId },
    }),
  })
  const customerCode = customerRes.data.customer_code as string

  // 2. Assign a dedicated virtual account to that customer.
  const dvaRes = await paystackFetchWithRetry('/dedicated_account', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerCode,
      preferred_bank: preferredBank(),
    }),
  })

  const dva = dvaRes.data as {
    account_number: string
    bank: { name: string; id: number; slug: string }
  }

  return {
    reference: customerCode,
    accountNumber: dva.account_number,
    bankName: dva.bank?.name ?? '',
    // Paystack's DVA payload carries the bank's slug/id, not a CBN sort code;
    // we persist the slug as the "code" since that's the stable identifier
    // Paystack exposes here.
    bankCode: dva.bank?.slug ?? (dva.bank?.id != null ? String(dva.bank.id) : ''),
  }
}

// Verify a Paystack webhook by recomputing the HMAC-SHA512 of the RAW request
// body with the platform secret key and timing-safe-comparing it to the
// x-paystack-signature header. Must be given the exact bytes Paystack sent
// (no re-serialization), or the digest won't match.
export function verifyPaystackWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
