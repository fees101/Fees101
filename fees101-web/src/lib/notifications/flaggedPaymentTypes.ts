// The admin_notification `type` values that represent a payment anomaly a human
// should eyeball — written by applyPayment.ts (suspicious_payment_amount) and
// paystackWebhookProcessor.ts (the two terminal mismatches). Kept in one place
// so the dashboard's "Payments to review" aggregate and the "Mark reviewed"
// dismiss action can never drift apart on which types count.
export const FLAGGED_PAYMENT_NOTIFICATION_TYPES = [
  'suspicious_payment_amount',
  'terminal_amount_mismatch',
  'terminal_repeat_payment',
] as const
