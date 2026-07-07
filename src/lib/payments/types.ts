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

export interface PaymentProvider {
  createDVA(params: CreateDVAParams): Promise<DVADetails>
  getDVA(reference: string): Promise<DVADetails | null>
  deleteDVA(reference: string): Promise<void>
  verifyTransaction(transactionReference: string): Promise<VerifiedTransaction | null>
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean
  // Lightweight — just enough to spot candidates for reconciliation.
  // verifyTransaction() is the source of truth for actually applying one.
  listDVATransactions(reference: string, page?: number, size?: number): Promise<DVATransactionSummary[]>
}

export interface ProviderCredentials {
  apiKey: string
  secretKey: string
  contractCode: string
}
