// Provider-agnostic payment gateway contract. Every school picks one provider
// (Model 0 — each school is its own merchant), but the rest of the app never
// talks to Monnify/Paystack directly, only through this interface.

export interface CreateDVAParams {
  // Our own identifier for this reserved account — always the student's id.
  reference: string
  // Shown to the parent's banking app as the account holder name.
  accountName: string
  // Synthetic, unique-per-student — never actually emailed to.
  customerEmail: string
  customerName: string
}

export interface DVADetails {
  reference: string
  accountNumber: string
  bankCode: string
  bankName: string
  accountName: string
  totalAmountReceived?: number
  transactionCount?: number
}

export interface VerifiedTransaction {
  transactionReference: string
  paymentReference: string
  amountPaid: number
  settlementAmount: number
  paidOn: string
  paymentStatus: string
  // The DVA reference (our accountReference / student id) this payment landed on.
  dvaReference: string
}

export interface DVATransactionSummary {
  transactionReference: string
  paymentStatus: string
}

// --- In-person card POS (Paystack Terminal) ---
// Paystack-only. See docs/pos-terminal-integration.md. Amounts cross this
// boundary in NAIRA (the rest of the app's unit); the provider converts to kobo.

export interface TerminalInfo {
  // The id /terminal/:id/event expects. Stored on school_terminals.terminal_id.
  terminalId: string
  serial?: string
  name?: string
  status?: string
}

export interface CreatePaymentRequestParams {
  amount: number // naira
  description?: string
  // The student's Paystack customer_code (CUS_…) when we have one — attaches the
  // charge to a known customer so the receipt and dashboard line up.
  customerCode?: string
  lineItems?: { name: string; amount: number }[] // naira
  // Returned back on charge.success / paymentrequest.success in response.metadata
  // (Paystack-confirmed 2026-10-05) — we stash our own reference here as a
  // reliable reconciliation key alongside data.reference.
  metadata?: Record<string, unknown>
}

export interface PaymentRequestResult {
  // Paystack's payment-request id (data.id) — what the push event references.
  paymentRequestId: string
  offlineReference: string
  requestCode?: string
}

export interface PushEventResult {
  // The terminal event id (data.id) to poll getTerminalEventStatus with. Null
  // when Paystack queued the push but did not return an id.
  eventId: string | null
  queued: boolean
}

export interface TerminalEventStatus {
  // True once Paystack confirms the device actually received the event.
  delivered: boolean
}

export interface PaymentProvider {
  // Machine name of the provider ('monnify' | 'paystack'). Stamped onto
  // payments / processed_provider_transactions rows so the persistence layer
  // stays provider-agnostic — callers read this instead of hardcoding a string.
  readonly name: string
  // Lightweight auth check — confirms the stored api key/secret are valid
  // without creating anything. Used by the settings "Test connection" button.
  verifyCredentials(): Promise<boolean>
  createDVA(params: CreateDVAParams): Promise<DVADetails>
  getDVA(reference: string): Promise<DVADetails | null>
  deleteDVA(reference: string): Promise<void>
  verifyTransaction(transactionReference: string): Promise<VerifiedTransaction | null>
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean
  // Lightweight — just enough to spot candidates for reconciliation.
  // verifyTransaction() is the source of truth for actually applying one.
  listDVATransactions(reference: string, page?: number, size?: number): Promise<DVATransactionSummary[]>

  // --- In-person card POS (Paystack Terminal), optional per provider ---
  // Only Paystack implements these. A provider that does not (Monnify) leaves
  // them undefined; callers check `provider.supportsTerminal?.()` first and
  // surface "not supported for this provider" rather than crashing.
  supportsTerminal?(): boolean
  // Auto-discovers the school's registered devices from their key.
  listTerminals?(): Promise<TerminalInfo[]>
  // Creates a Paystack payment request (invoice); returns the ids we store and
  // later match an inbound charge against.
  createPaymentRequest?(params: CreatePaymentRequestParams): Promise<PaymentRequestResult>
  // Pushes the payment request to a registered device so it prompts for payment.
  pushEventToTerminal?(
    terminalId: string,
    params: { paymentRequestId: string; offlineReference: string }
  ): Promise<PushEventResult>
  // Confirms the device actually received a pushed event.
  getTerminalEventStatus?(terminalId: string, eventId: string): Promise<TerminalEventStatus>
}

export interface ProviderCredentials {
  apiKey: string
  secretKey: string
  // Monnify-only: its merchant contract code. Paystack has no equivalent, so
  // this is optional. For Paystack, apiKey holds the public key (pk_…) and
  // secretKey the secret key (sk_…) — only the secret is used server-side.
  contractCode?: string
}
