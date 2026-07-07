// Single source of truth for how a payments.method value reads to a human —
// used anywhere a payment's method renders: the student payment history
// tab, activity timeline, invoice detail page, and (once built) receipts.
const LABELS: Record<string, string> = {
  provider_dva: 'Bank transfer (virtual account)',
  bank_transfer_manual: 'Bank transfer (manual)',
  cash: 'Cash',
  pos: 'POS',
  cheque: 'Cheque',
  other: 'Other',
}

export function formatPaymentMethod(method: string): string {
  if (LABELS[method]) return LABELS[method]
  // Fallback for anything unmapped — still readable rather than a raw enum value.
  return method
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
