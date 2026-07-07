// Monnify implementation of PaymentProvider. Every endpoint/verb here was
// verified against the real sandbox API, not written from docs/memory:
// - create: POST v2 /reserved-accounts
// - get:    GET  v2 /reserved-accounts/{ref}
// - delete: DELETE v1 /reserved-accounts/reference/{ref}  (note the /reference/ segment, and v1 not v2)
// - verify: GET  v2 /transactions/{ref}
// - webhook signature: HMAC-SHA512(secretKey, rawBody), not a plain concatenated hash

import crypto from 'crypto'
import { PaymentProvider, ProviderCredentials, CreateDVAParams, DVADetails, VerifiedTransaction } from './types'

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
  const res = await fetch(`${baseUrl}${path}`, init)
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
  private creds: ProviderCredentials
  private baseUrl: string

  constructor(credentials: ProviderCredentials) {
    this.creds = credentials
    this.baseUrl = process.env.MONNIFY_BASE_URL || DEFAULT_BASE_URL
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

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    const computed = crypto.createHmac('sha512', this.creds.secretKey).update(rawBody).digest('hex')
    const computedBuf = Buffer.from(computed, 'utf8')
    const headerBuf = Buffer.from(signatureHeader || '', 'utf8')
    if (computedBuf.length !== headerBuf.length) return false
    return crypto.timingSafeEqual(computedBuf, headerBuf)
  }
}
