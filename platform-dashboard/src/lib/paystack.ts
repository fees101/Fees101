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

const PAYSTACK_BASE = 'https://api.paystack.co'

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error('Missing PAYSTACK_SECRET_KEY')
  return key
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
