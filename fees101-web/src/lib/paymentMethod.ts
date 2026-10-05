// Single source of truth for how a payments.method value reads to a human —
// used anywhere a payment's method renders: the student payment history
// tab, activity timeline, invoice detail page, and (once built) receipts.
const LABELS: Record<string, string> = {
  provider_dva: 'Bank transfer (virtual account)',
  provider_terminal: 'Card terminal (in person)',
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

// Short "how the money arrived" label for compact surfaces — the dashboard
// Record, the activity feed, the student timeline — where the full method label
// is too long. Says the channel specifically (Transfer / Card terminal / Cash…)
// so a reader never sees a bare "Automatic" without knowing how it was paid.
const CHANNELS: Record<string, string> = {
  provider_dva: 'Transfer',
  provider_terminal: 'Card terminal',
  bank_transfer_manual: 'Transfer',
  cash: 'Cash',
  pos: 'POS',
  cheque: 'Cheque',
  other: 'Other',
}

export function paymentChannelLabel(method: string | null | undefined): string {
  if (!method) return ''
  return CHANNELS[method] || formatPaymentMethod(method)
}
