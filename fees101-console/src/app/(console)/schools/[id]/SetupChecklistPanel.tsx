import { getSchoolSetupChecklist } from '@/lib/queries'
import { CheckCircle2, Circle } from '@/lib/icons'

function Row({ done, label, detail, last }: { done: boolean; label: string; detail: string; last: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 0',
        borderBottom: last ? 'none' : '1px solid var(--border)',
      }}
    >
      {done ? (
        <CheckCircle2 size={18} color="var(--good)" style={{ flexShrink: 0, marginTop: 1 }} />
      ) : (
        <Circle size={18} color="var(--faint)" style={{ flexShrink: 0, marginTop: 1 }} />
      )}
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: done ? 'var(--ink)' : 'var(--muted)' }}>{label}</p>
        <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{detail}</p>
      </div>
      <span className={done ? 'tag tag-good' : 'tag tag-warn'}>{done ? 'Done' : 'Pending'}</span>
    </div>
  )
}

export default async function SetupChecklistPanel({ schoolId }: { schoolId: string }) {
  const c = await getSchoolSetupChecklist(schoolId)

  const providerName = c.paymentProvider === 'monnify' ? 'Monnify' : c.paymentProvider === 'paystack' ? 'Paystack' : null

  const items = [
    {
      done: c.paymentProviderConnected,
      label: 'Payment provider connected',
      detail: c.paymentProviderConnected
        ? `${providerName} · webhook endpoint live${c.keysVerified ? ' · keys verified' : ' · keys not yet verified'}`
        : 'No provider credentials saved yet — required before any payment can be collected.',
    },
    {
      done: c.billingConfigured,
      label: 'Billing / fee structure set up',
      detail: c.billingConfigured
        ? `${c.activeCycleName} · ${c.feeItemCount} fee item${c.feeItemCount === 1 ? '' : 's'}`
        : 'No active billing cycle with fee items yet.',
    },
    {
      done: c.studentsAdded,
      label: 'Students added',
      detail: c.studentsAdded
        ? `${c.studentCount} active student${c.studentCount === 1 ? '' : 's'}`
        : 'No students added yet.',
    },
  ]

  const allDone = items.every((i) => i.done)

  return (
    <div className="panel" style={{ padding: 20, marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Setup checklist</p>
        <span className={allDone ? 'tag tag-good' : 'tag tag-warn'}>{allDone ? 'Ready to collect' : 'Setup incomplete'}</span>
      </div>
      <div>
        {items.map((item, i) => (
          <Row key={item.label} done={item.done} label={item.label} detail={item.detail} last={i === items.length - 1} />
        ))}
      </div>
    </div>
  )
}
