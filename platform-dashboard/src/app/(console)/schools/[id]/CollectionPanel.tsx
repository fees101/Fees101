'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  provisionSchoolPlatformDva,
  getSchoolCollectionData,
  type CollectionData,
} from './collectionActions'

interface Props {
  schoolId: string
}

// Platform-collection panel: the school pays its monthly platform bill by
// transferring INTO the Fees101-owned DVA shown here (flat ₦300/transfer).
// Standalone — it loads its own data from a server action given just the
// schoolId, so the parent page only has to render <CollectionPanel schoolId>.
export default function CollectionPanel({ schoolId }: Props) {
  const router = useRouter()
  const [data, setData] = useState<CollectionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await getSchoolCollectionData(schoolId)
      setData(d)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load collection data.')
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => { load() }, [load])

  async function handleProvision() {
    setBusy(true)
    setMessage(null)
    const result = await provisionSchoolPlatformDva(schoolId)
    setBusy(false)
    if ('error' in result) {
      setMessage(`Provisioning failed: ${result.error}`)
    } else {
      setMessage(`Payment account ready: ${result.accountNumber} (${result.bankName}).`)
      await load()
      router.refresh()
    }
  }

  const fmtNaira = (n: number) => `₦${n.toLocaleString()}`
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  return (
    <div className="panel" style={{ padding: 20 }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Platform collection — school transfers its monthly bill into this Fees101 account (flat ₦300/transfer)
      </p>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <>
          {/* DVA details, or a provision button if none yet. */}
          {data?.dva ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Account number</div>
                  <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: 0.5 }}>{data.dva.accountNumber}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Bank</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{data.dva.bankName}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 18 }}>
              <button className="btn btn-primary" disabled={busy} onClick={handleProvision}>
                {busy ? 'Provisioning…' : 'Provision payment account'}
              </button>
            </div>
          )}

          {/* Current billing status. */}
          <div style={{ marginBottom: 18 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Billing status: </span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{data?.billingStatus ?? '—'}</span>
          </div>

          {/* Recent charges (DVA transfers + any card charges). */}
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Recent payments</div>
            {data && data.charges.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Amount</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Method</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Date</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.charges.map(c => (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>{fmtNaira(c.amount)}</td>
                      <td style={{ padding: '6px 8px' }}>{c.method === 'dva_transfer' ? 'Transfer' : 'Card'}</td>
                      <td style={{ padding: '6px 8px' }}>{fmtDate(c.paidAt ?? c.createdAt)}</td>
                      <td style={{ padding: '6px 8px' }}>{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>No payments yet.</p>
            )}
          </div>
        </>
      )}

      {message && <p style={{ fontSize: 13, marginTop: 14, color: 'var(--accent)' }}>{message}</p>}
    </div>
  )
}
