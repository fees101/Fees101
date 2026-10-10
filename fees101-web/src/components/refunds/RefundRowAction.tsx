'use client'

import { useState } from 'react'
import RequestRefundDrawer from './RequestRefundDrawer'

interface Props {
  payment: {
    id: string
    studentId: string
    amount: number
    cycleName?: string | null
    paidAt?: string | null
    provider?: string | null
  }
  // Override for an ink-ground surface (e.g. the invoice detail page), whose
  // lifted signal-red differs from the paper-ground --color-signal-text.
  color?: string
}

// Small trigger for the "Refund this payment" entry point, embedded inline
// next to a payment row. Kept as its own client component so the server
// components that list payments (StudentActivityTimeline) don't need to
// manage drawer state themselves.
export default function RefundRowAction({ payment, color = 'var(--color-signal-text)' }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold uppercase tracking-[0.06em] hover:underline"
        style={{ color }}
      >
        Refund
      </button>
      {open && <RequestRefundDrawer payment={payment} onClose={() => setOpen(false)} />}
    </>
  )
}
