// Monnify implementation of PaymentProvider. Every endpoint/verb here was
// verified against the real sandbox API, not written from docs/memory:
// - create: POST v2 /reserved-accounts
// - get:    GET  v2 /reserved-accounts/{ref}
// - delete: DELETE v1 /reserved-accounts/reference/{ref}  (note the /reference/ segment, and v1 not v2)
// - verify: GET  v2 /transactions/{ref}
// - list:   GET  v1 /reserved-accounts/transactions?accountReference={ref}  (v1, not v2 — different from get/delete)
// - webhook signature: HMAC-SHA512(secretKey, rawBody), not a plain concatenated hash
// - refund:  POST v1 /refunds/initiate-refund   GET v1 /refunds/{refundReference}
//   NOTE unlike the DVA methods above, the refund endpoints were written from
//   Monnify's documented Refund API, NOT verified against a live sandbox
//   refund (this session had no completed Monnify transaction available to
//   refund). Same auth/error-handling shape as every other call in this file
//   (authedRequest, requestSuccessful/responseMessage). Verify against a real
//   sandbox refund before relying on this for a live school — see the
//   refund-sweep cron (src/app/api/admin/refund-sweep) and the
//   refund.processed-equivalent webhook branch in webhookProcessor.ts, which
//   both depend on the exact field names/status strings here being right.
//
// Monnify has no Terminal/in-person-POS product the way Paystack does — it is
// a collections gateway (reserved accounts, cards, transfers), not a card
// device network. PaymentProvider's supportsTerminal()/listTerminals()/etc.
// are therefore left undefined here deliberately, same as every other
// provider that doesn't offer them — src/lib/payments/terminal.ts already
// gates on provider.supportsTerminal?.() and tells a Monnify school plainly
// that in-person terminals are Paystack-only.

import crypto from 'crypto'
import { PaymentProvider, ProviderCredentials, CreateDVAParams, DVADetails, VerifiedTransaction, DVATransactionSummary, RefundResult } from './types'
import { isProviderDownError } from './providerErrors'
import { fetchWithRateLimitRetry } from '@/lib/http/rateLimitedFetch'

const DEFAULT_BASE_URL = 'https://sandbox.monnify.com'
// Refresh well before the real ~60-minute expiry, not right at it.
const TOKEN_REFRESH_MARGIN_MS = 50 * 60 * 1000
// Parents recognize Wema by name; Monnify's default (Moniepoint) doesn't carry the same trust.
const PREFERRED_BANK_CODES = ['035']

interface CachedToken {
  token: string
  expiresAt: number
}

// Module-level so it survives across requests within the same server
// process — an instance-level cache would be useless since a new
// MonnifyProvider gets constructed per call.
const tokenCache = new Map<string, CachedToken>()

async function monnifyRequest(
  creds: ProviderCredentials,
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number, json: any }> {
  // Same rate-limit resilience as Paystack: ride out short 429 bursts so bulk
  // reserved-account creation doesn't fail hard when Monnify throttles.
  const res = await fetchWithRateLimitRetry(`${baseUrl}${path}`, init)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function getAccessToken(creds: ProviderCredentials, baseUrl: string): Promise<string> {
  const cached = tokenCache.get(creds.apiKey)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const auth = Buffer.from(`${creds.apiKey}:${creds.secretKey}`).toString('base64')
  const { json } = await monnifyRequest(creds, baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
  })

  if (!json.requestSuccessful) {
    throw new Error(`Monnify auth failed: ${json.responseMessage || 'unknown error'}`)
  }

  const token = json.responseBody.accessToken as string
  tokenCache.set(creds.apiKey, { token, expiresAt: Date.now() + TOKEN_REFRESH_MARGIN_MS })
  return token
}

// Authenticated request with one automatic retry if the cached token turns
// out to be stale server-side (e.g. revoked) even though our cache thought
// it still had time left.
async function authedRequest(
  creds: ProviderCredentials,
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  isRetry = false
): Promise<{ status: number, json: any }> {
  const token = await getAccessToken(creds, baseUrl)
  const result = await monnifyRequest(creds, baseUrl, path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (result.status === 401 && !isRetry) {
    tokenCache.delete(creds.apiKey)
    return authedRequest(creds, baseUrl, path, init, true)
  }

  return result
}

function toDVADetails(responseBody: any): DVADetails {
  const account = responseBody.accounts?.[0] || {}
  return {
    reference: responseBody.accountReference,
    accountNumber: account.accountNumber,
    bankCode: account.bankCode,
    bankName: account.bankName,
    accountName: account.accountName,
    totalAmountReceived: responseBody.totalAmount !== undefined ? Number(responseBody.totalAmount) : undefined,
    transactionCount: responseBody.transactionCount,
  }
}

export class MonnifyProvider implements PaymentProvider {
  readonly name = 'monnify'
  private creds: ProviderCredentials
  private baseUrl: string

  constructor(credentials: ProviderCredentials) {
    this.creds = credentials
    this.baseUrl = process.env.MONNIFY_BASE_URL || DEFAULT_BASE_URL
  }

  // Just enough to prove the api key + secret authenticate against Monnify.
  // getAccessToken throws when auth fails, so a clean return means valid
  // creds. Only a genuine auth rejection is swallowed to `false` here — a
  // network-level failure (provider unreachable) is deliberately rethrown so
  // the caller can tell "your keys are wrong" apart from "Monnify is down"
  // (see isProviderDownError).
  async verifyCredentials(): Promise<boolean> {
    try {
      await getAccessToken(this.creds, this.baseUrl)
      return true
    } catch (err) {
      if (isProviderDownError(err)) throw err
      return false
    }
  }

  async createDVA(params: CreateDVAParams): Promise<DVADetails> {
    const { json } = await authedRequest(this.creds, this.baseUrl, '/api/v2/bank-transfer/reserved-accounts', {
      method: 'POST',
      body: JSON.stringify({
        accountReference: params.reference,
        accountName: params.accountName,
        currencyCode: 'NGN',
        contractCode: this.creds.contractCode,
        customerEmail: params.customerEmail,
        customerName: params.customerName,
        getAllAvailableBanks: false,
        preferredBanks: PREFERRED_BANK_CODES,
      }),
    })

    if (!json.requestSuccessful) {
      throw new Error(`Monnify createDVA failed: ${json.responseMessage || 'unknown error'}`)
    }

    return toDVADetails(json.responseBody)
  }

  async getDVA(reference: string): Promise<DVADetails | null> {
    const { status, json } = await authedRequest(
      this.creds,
      this.baseUrl,
      `/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(reference)}`
    )

    if (status === 404 || !json.requestSuccessful) return null
    return toDVADetails(json.responseBody)
  }

  async deleteDVA(reference: string): Promise<void> {
    const { json } = await authedRequest(
      this.creds,
      this.baseUrl,
      `/api/v1/bank-transfer/reserved-accounts/reference/${encodeURIComponent(reference)}`,
      { method: 'DELETE' }
    )

    if (!json.requestSuccessful) {
      throw new Error(`Monnify deleteDVA failed: ${json.responseMessage || 'unknown error'}`)
    }
  }

  async verifyTransaction(transactionReference: string): Promise<VerifiedTransaction | null> {
    const { status, json } = await authedRequest(
      this.creds,
      this.baseUrl,
      `/api/v2/transactions/${encodeURIComponent(transactionReference)}`
    )

    if (status === 404 || !json.requestSuccessful) return null

    const body = json.responseBody
    return {
      transactionReference: body.transactionReference,
      paymentReference: body.paymentReference,
      amountPaid: Number(body.amountPaid),
      settlementAmount: Number(body.settlementAmount),
      paidOn: body.paidOn,
      paymentStatus: body.paymentStatus,
      dvaReference: body.product?.reference,
    }
  }

  async listDVATransactions(reference: string, page = 0, size = 20): Promise<DVATransactionSummary[]> {
    const { json } = await authedRequest(
      this.creds,
      this.baseUrl,
      `/api/v1/bank-transfer/reserved-accounts/transactions?accountReference=${encodeURIComponent(reference)}&page=${page}&size=${size}`
    )

    if (!json.requestSuccessful) return []

    return (json.responseBody?.content || []).map((t: any) => ({
      transactionReference: t.transactionReference,
      paymentStatus: t.paymentStatus,
    }))
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    const computed = crypto.createHmac('sha512', this.creds.secretKey).update(rawBody).digest('hex')
    const computedBuf = Buffer.from(computed, 'utf8')
    const headerBuf = Buffer.from(signatureHeader || '', 'utf8')
    if (computedBuf.length !== headerBuf.length) return false
    return crypto.timingSafeEqual(computedBuf, headerBuf)
  }

  // POST /refunds/initiate-refund — refunds a specific transaction, in full or
  // in part, back to the original payer. Monnify requires its own
  // refundReference (we mint one) and the refund amount explicitly — there is
  // no "omit amount for a full refund" shorthand like Paystack's, so a caller
  // must always pass amountNaira (the server action always does: it reads the
  // original payment/refund-request amount first). Monnify's response can
  // confirm synchronously ('COMPLETED') or come back pending/processing,
  // mirroring Paystack's processed/pending split — the caller (refunds
  // actions.ts) already handles either outcome the same way for both
  // providers.
  //
  // customerNote confirmed REQUIRED against the real Monnify sandbox
  // (2026-10-10) — the docs-based first draft of this method sent only
  // refundReason and Monnify's own API rejected it with "The customerNote
  // field is required". It also turned out to be capped at 16 characters
  // ("Customer Note must be between 1 and 16 characters", also confirmed live)
  // — far too short for our actual refund reason/reference, so it carries a
  // fixed short label instead; refundReason carries the real explanation the
  // requester wrote, which Monnify does not appear to length-limit.
  async refundTransaction(reference: string, amountNaira?: number, note?: string): Promise<RefundResult> {
    if (amountNaira == null) {
      throw new Error('Monnify refundTransaction requires an explicit amount')
    }
    const refundReference = `FEES101-RF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { json } = await authedRequest(this.creds, this.baseUrl, '/api/v1/refunds/initiate-refund', {
      method: 'POST',
      body: JSON.stringify({
        transactionReference: reference,
        refundReference,
        refundAmount: amountNaira,
        refundReason: note || 'Refund requested via Fees101',
        customerNote: 'Fees101 refund',
      }),
    })
    if (!json.requestSuccessful || !json.responseBody?.refundReference) {
      throw new Error(`Monnify refundTransaction failed: ${json.responseMessage || 'unknown error'}`)
    }
    const status = String(json.responseBody.refundStatus || json.responseBody.status || 'pending').toUpperCase()
    return {
      id: String(json.responseBody.refundReference),
      // Normalize to the same vocabulary refunds actions.ts already expects
      // from Paystack ('processed' | 'pending' | anything else = failed).
      status: (status === 'COMPLETED' || status === 'SUCCESSFUL') ? 'processed' : 'pending',
    }
  }

  // GET /refunds/{refundReference} — the refund-sweep safety net's fallback
  // for a missed/delayed webhook, same role as Paystack's verifyRefund.
  async verifyRefund(monnifyRefundReference: string): Promise<{ status: string }> {
    const { json } = await authedRequest(
      this.creds,
      this.baseUrl,
      `/api/v1/refunds/${encodeURIComponent(monnifyRefundReference)}`
    )
    if (!json.requestSuccessful || !json.responseBody) {
      throw new Error(`Monnify verifyRefund failed: ${json.responseMessage || 'unknown error'}`)
    }
    const status = String(json.responseBody.refundStatus || json.responseBody.status || 'pending').toUpperCase()
    if (status === 'COMPLETED' || status === 'SUCCESSFUL') return { status: 'processed' }
    if (status === 'FAILED' || status === 'REJECTED' || status === 'DECLINED') return { status: 'failed' }
    return { status: 'pending' }
  }
}
