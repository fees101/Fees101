import Link from 'next/link'
import { getSchoolUsageOutliers } from '@/lib/opsQueries'

// Usage & outliers — per-school message/webhook volume relative to the
// platform average, as an abuse/misuse/cost-risk signal. 2026-10-10 owner
// feedback: "are you monitoring things like who is spending the most, why
// they are beating the average we expected, why they're costing more if
// they are misusing the platform, flagging things that can cost us."
//
// Built on VOLUME (message count, webhook count), not cost: message_logs.
// cost_amount is always null/₦0 today — a known, already-flagged bug, out of
// scope for this pass — so a naira figure here would be fabricated. Volume
// per active student (messaging) and webhook events per payment (webhook
// traffic) are honest proxies that don't depend on it. A school at 2x+ the
// platform average on either ratio is flagged with the specific numbers, not
// just a bare "high" label.
function fmtRatio(n: number | null) {
  return n === null ? '—' : `${n.toFixed(1)}x`
}

export default async function UsageOutliersPage() {
  const usage = await getSchoolUsageOutliers()
  const flaggedSchools = usage.schools.filter(s => s.flags.length > 0)

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div className="kicker">Payments & health</div>
        <h1 style={{ fontSize: 24, marginTop: 6 }}>Usage & outliers</h1>
      </div>

      <div className="panel" style={{ marginBottom: 20, padding: '14px 16px', fontSize: 13, color: 'var(--muted)' }}>
        Ranked by messaging and webhook volume relative to the platform average — a disproportionate consumer stands out here regardless of its size. Built on message/webhook counts, not cost: <code>message_logs.cost_amount</code> is not populated yet (known gap, tracked separately), so no naira figure is shown.
      </div>

      {flaggedSchools.length > 0 && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
            Flagged — {usage.outlierMultiple}x+ the platform average
          </div>
          <table>
            <thead><tr><th>School</th><th>Reason</th></tr></thead>
            <tbody>
              {flaggedSchools.map(s => (
                <tr key={s.schoolId}>
                  <td style={{ fontWeight: 600, verticalAlign: 'top' }}><Link href={`/schools/${s.schoolId}`}>{s.schoolName}</Link></td>
                  <td>
                    {s.flags.map((f, i) => <div key={i} style={{ marginBottom: i < s.flags.length - 1 ? 4 : 0 }}>{f}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <div style={{ padding: '14px 16px', borderBottom: '2px solid var(--rule)', fontWeight: 800 }}>
          All schools — platform average {usage.platformAvgMessagesPerStudent.toFixed(1)} msgs/student, {usage.platformAvgWebhooksPerPayment.toFixed(1)} webhook events/payment
        </div>
        <table>
          <thead>
            <tr>
              <th>School</th><th>Active students</th><th>Messages</th><th>Msgs/student</th><th>vs avg</th>
              <th>Webhook events</th><th>Payments</th><th>Webhooks/payment</th><th>vs avg</th>
            </tr>
          </thead>
          <tbody>
            {usage.schools.map(s => (
              <tr key={s.schoolId}>
                <td style={{ fontWeight: 600 }}><Link href={`/schools/${s.schoolId}`}>{s.schoolName}</Link></td>
                <td>{s.activeStudents}</td>
                <td>{s.messageCount}</td>
                <td>{s.messagesPerStudent === null ? '—' : s.messagesPerStudent.toFixed(1)}</td>
                <td>
                  {s.messageRatioToAverage !== null && s.messageRatioToAverage >= usage.outlierMultiple ? (
                    <span className="tag tag-warn"><span className="dot" />{fmtRatio(s.messageRatioToAverage)}</span>
                  ) : fmtRatio(s.messageRatioToAverage)}
                </td>
                <td>{s.webhookCount}</td>
                <td>{s.paymentCount}</td>
                <td>{s.webhooksPerPayment === null ? '—' : s.webhooksPerPayment.toFixed(1)}</td>
                <td>
                  {s.webhookRatioToAverage !== null && s.webhookRatioToAverage >= usage.outlierMultiple ? (
                    <span className="tag tag-warn"><span className="dot" />{fmtRatio(s.webhookRatioToAverage)}</span>
                  ) : fmtRatio(s.webhookRatioToAverage)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
