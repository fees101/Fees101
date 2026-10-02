// Platform billing via Paystack Direct Debit — the Fees101 account debiting
// schools automatically. This is the PLATFORM's own Paystack account (same one
// the console uses for platform DVA), NOT a school's per-school merchant creds
// in src/lib/payments/ (those collect parent fees — a different account and
// flow). The key lives in PLATFORM_PAYSTACK_SECRET_KEY so this never reuses a
// school's stored credentials.
//
// Direct Debit lets us pull dues straight from a school's bank account after a
// one-time mandate authorization — the cheap bank rail, fully automatic, no
// manual transfer and no reminders. Nigeria-only, and the feature must be
// enabled on the Paystack account; in test mode the flow is simulated.
//
// Lifecycle:
//   1. initializeMandateSetup() -> hosted checkout; the school pays the one-time
//      setup fee via the `bank` channel with custom_filters.recurring=true,
//      which both charges the fee AND creates a reusable mandate.
//   2. verifyTransaction() on redirect -> pulls authorization_code (the mandate)
//      + confirms the setup fee was paid. This is synchronous, so it gates app
//      entry immediately.
//   3. The mandate takes ~3h to become chargeable (direct_debit.authorization
//      .active). verifyAuthorizationStatus() checks that lazily before the first
//      recurring debit, 65+ days out — no webhook needed for the setup slice.
//   4. chargeMandate() runs each recurring debit against authorization_code.

import crypto from 'node:crypto'

const PAYSTACK_BASE = 'https://api.paystack.co'

function secretKey(): string {
  const key = process.env.PLATFORM_PAYSTACK_SECRET_KEY
  if (!key) throw new Error('Missing PLATFORM_PAYSTACK_SECRET_KEY')
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

// Step 1: initialize the setup-fee transaction, completing it creates a
// reusable mandate either way. `card` channel authorizations are reusable by
// default on Paystack; `bank` needs the recurring filter and is only offered
// for banks Paystack has direct-debit-enabled (a short, bank-specific list —
// most major banks, e.g. GTBank/Access/Zenith/UBA/FCMB, aren't on it yet).
// Offering both lets the owner use card when their bank isn't supported.
// amountNaira is converted to kobo. Returns the hosted-checkout URL.
export async function initializeMandateSetup(params: {
  email: string
  amountNaira: number
  reference: string
  callbackUrl: string
}) {
  const body = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: Math.round(params.amountNaira * 100),
      reference: params.reference,
      callback_url: params.callbackUrl,
      channels: ['card', 'bank'],
      metadata: { custom_filters: { recurring: true } },
    }),
  })
  return body.data as { authorization_url: string; access_code: string; reference: string }
}

// Step 2: verify the setup-fee transaction after Paystack redirects back. The
// `authorization` block carries the reusable mandate (authorization_code) when
// the bank/recurring flow succeeded.
export async function verifyTransaction(reference: string) {
  const body = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  return body.data as {
    status: string // 'success' | 'failed' | 'abandoned' | ...
    amount: number
    gateway_response: string
    customer: { customer_code: string; email: string }
    authorization: {
      authorization_code: string
      channel: string
      bank: string
      reusable: boolean
      account_name: string | null
    }
  }
}

// Lazily confirm whether a mandate has become chargeable (Paystack takes ~3h
// after authorization). Used before a recurring debit; avoids depending on a
// webhook for the setup slice.
export async function verifyAuthorizationStatus(reference: string) {
  const body = await paystackFetch(
    `/customer/authorization/verify/${encodeURIComponent(reference)}`,
  )
  return body.data as {
    authorization_code: string
    channel: string
    bank: string
    active: boolean
    customer: { code: string; email: string }
  }
}

// A recurring debit against an established mandate. amountNaira -> kobo.
export async function chargeMandate(params: {
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
      currency: 'NGN',
      reference: params.reference,
    }),
  })
  // Direct debit returns status 'processing' first; the final result comes via
  // charge.success / verify. Callers treat 'success' and 'processing' as "not
  // failed".
  return body.data as { status: string; reference: string; gateway_response: string }
}

// Revoke a mandate (customer request or account teardown).
export async function deactivateMandate(authorizationCode: string) {
  await paystackFetch('/customer/authorization/deactivate', {
    method: 'POST',
    body: JSON.stringify({ authorization_code: authorizationCode }),
  })
}

// Verify a platform-account webhook by HMAC-SHA512 of the RAW body with the
// platform secret key. Must be the exact bytes Paystack sent.
export function verifyPaystackWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
