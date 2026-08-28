// Paystack implementation of PaymentProvider. Every endpoint/verb here was
// verified against the real sandbox API, not written from docs/memory:
// - auth:    Authorization: Bearer {secretKey}  (no token exchange, unlike Monnify)
// - create:  POST /customer  then  POST /dedicated_account   (both synchronous in test mode)
// - get:     GET  /customer/{customer_code}      → data.dedicated_account
// - delete:  DELETE /dedicated_account/{id}       (id resolved via the customer)
// - verify:  GET  /transaction/verify/{reference}
// - list:    GET  /transaction?customer={numeric_id}
// - webhook signature: HMAC-SHA512(secretKey, rawBody), header x-paystack-signature
//
// Model note: Paystack does not let us choose the account reference the way
// Monnify does. It mints a customer_code (CUS_…) and an account number for us.
// We therefore store the customer_code as our provider_dva_reference — it is
// stable per student and is present on every charge.success webhook
// (data.customer.customer_code), which is how we match a payment back to a
// student. Amounts are in kobo on the wire and converted to naira here.

import crypto from 'crypto'
import { PaymentProvider, ProviderCredentials, CreateDVAParams, DVADetails, VerifiedTransaction, DVATransactionSummary } from './types'

const BASE_URL = 'https://api.paystack.co'
// Parents recognize Wema by name (same reasoning as Monnify's 035 default).
// In test mode Paystack only mints against its 'test-bank' pseudo-provider.
const LIVE_PREFERRED_BANK = process.env.PAYSTACK_PREFERRED_BANK || 'wema-bank'

async function paystackRequest(
  secretKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

// Paystack wants first_name/last_name; we only ever hold a single display name.
function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean)
  const first_name = parts[0] || 'Student'
  const last_name = parts.slice(1).join(' ') || first_name
  return { first_name, last_name }
}

function toDVADetails(customerCode: string, da: any): DVADetails {
  return {
    reference: customerCode,
    accountNumber: da?.account_number,
    // Paystack has no numeric NUBAN code like Monnify — the bank slug is its
    // stable identifier; the human-facing name lives in bankName.
    bankCode: da?.bank?.slug || String(da?.bank?.id ?? ''),
    bankName: da?.bank?.name,
    accountName: da?.account_name,
  }
}

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack'
  private creds: ProviderCredentials

  constructor(credentials: ProviderCredentials) {
    this.creds = credentials
  }

  private get preferredBank(): string {
    // Key prefix determines mode (same base URL for test/live).
    return this.creds.secretKey.startsWith('sk_test') ? 'test-bank' : LIVE_PREFERRED_BANK
  }

  // A cheap authenticated GET — 200 means the secret key is valid, 401 means not.
  async verifyCredentials(): Promise<boolean> {
    try {
      const { status } = await paystackRequest(this.creds.secretKey, 'GET', '/customer?perPage=1')
      return status === 200
    } catch {
      return false
    }
  }

  async createDVA(params: CreateDVAParams): Promise<DVADetails> {
    const { first_name, last_name } = splitName(params.customerName || params.accountName)

    // 1. Create the customer. Paystack keys customers by email, so this is
    // effectively idempotent per student (our email is student-{id}@…internal).
    const cust = await paystackRequest(this.creds.secretKey, 'POST', '/customer', {
      email: params.customerEmail,
      first_name,
      last_name,
    })
    if (!cust.json?.status || !cust.json?.data?.customer_code) {
      throw new Error(`Paystack createDVA failed (customer): ${cust.json?.message || 'unknown error'}`)
    }
    const customerCode = cust.json.data.customer_code as string

    // 2. Assign a dedicated NUBAN. Returns synchronously in test mode; live
    // (wema-bank/titan-paystack) also returns the assigned account inline.
    const da = await paystackRequest(this.creds.secretKey, 'POST', '/dedicated_account', {
      customer: customerCode,
      preferred_bank: this.preferredBank,
    })
    if (!da.json?.status || !da.json?.data?.account_number) {
      throw new Error(`Paystack createDVA failed (dedicated_account): ${da.json?.message || 'unknown error'}`)
    }

    return toDVADetails(customerCode, da.json.data)
  }

  async getDVA(reference: string): Promise<DVADetails | null> {
    // reference is the customer_code — the customer record carries the DVA.
    const { status, json } = await paystackRequest(
      this.creds.secretKey,
      'GET',
      `/customer/${encodeURIComponent(reference)}`
    )
    if (status === 404 || !json?.status) return null
    const da = json.data?.dedicated_account || json.data?.dedicated_accounts?.[0]
    if (!da?.account_number) return null
    return toDVADetails(reference, da)
  }

  async deleteDVA(reference: string): Promise<void> {
    // Resolve the dedicated account's numeric id via the customer, then
    // deactivate it. No-op if the customer has no active DVA.
    const { json } = await paystackRequest(
      this.creds.secretKey,
      'GET',
      `/customer/${encodeURIComponent(reference)}`
    )
    const da = json?.data?.dedicated_account || json?.data?.dedicated_accounts?.[0]
    if (!da?.id) return
    const del = await paystackRequest(this.creds.secretKey, 'DELETE', `/dedicated_account/${da.id}`)
    if (del.status >= 400) {
      throw new Error(`Paystack deleteDVA failed: ${del.json?.message || `HTTP ${del.status}`}`)
    }
  }

  async verifyTransaction(transactionReference: string): Promise<VerifiedTransaction | null> {
    const { status, json } = await paystackRequest(
      this.creds.secretKey,
      'GET',
      `/transaction/verify/${encodeURIComponent(transactionReference)}`
    )
    if (status === 404 || !json?.status || !json?.data) return null

    const d = json.data
    const amountNaira = Number(d.amount || 0) / 100
    const settlementNaira = (Number(d.amount || 0) - Number(d.fees || 0)) / 100
    return {
      transactionReference: String(d.reference),
      // Paystack has a single reference per transaction (no separate payment ref).
      paymentReference: String(d.reference),
      amountPaid: amountNaira,
      settlementAmount: settlementNaira,
      paidOn: d.paid_at || d.paidAt || d.transaction_date || new Date().toISOString(),
      // Normalize to the same vocabulary Monnify uses so callers stay uniform.
      paymentStatus: d.status === 'success' ? 'PAID' : d.status,
      dvaReference: d.customer?.customer_code,
    }
  }

  async listDVATransactions(reference: string, page = 0, size = 20): Promise<DVATransactionSummary[]> {
    // Paystack lists transactions by numeric customer id, not customer_code —
    // resolve it first. reference is the customer_code we stored.
    const cust = await paystackRequest(
      this.creds.secretKey,
      'GET',
      `/customer/${encodeURIComponent(reference)}`
    )
    const customerId = cust.json?.data?.id
    if (!customerId) return []

    // Paystack paging is 1-indexed; our callers pass 0-indexed pages.
    const { json } = await paystackRequest(
      this.creds.secretKey,
      'GET',
      `/transaction?customer=${customerId}&perPage=${size}&page=${page + 1}`
    )
    if (!json?.status) return []

    return (json.data || []).map((t: any) => ({
      transactionReference: String(t.reference),
      // Normalize 'success' → 'PAID' so reconcile's filter is provider-agnostic.
      paymentStatus: t.status === 'success' ? 'PAID' : t.status,
    }))
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    const computed = crypto.createHmac('sha512', this.creds.secretKey).update(rawBody).digest('hex')
    const computedBuf = Buffer.from(computed, 'utf8')
    const headerBuf = Buffer.from(signatureHeader || '', 'utf8')
    if (computedBuf.length !== headerBuf.length) return false
    return crypto.timingSafeEqual(computedBuf, headerBuf)
  }
}
