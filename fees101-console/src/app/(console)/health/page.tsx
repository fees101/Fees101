export default function HealthPage() {
  return (
    <div>
      <div className="kicker">Payments & health</div>
      <h1 style={{ fontSize: 24, marginTop: 6, marginBottom: 14 }}>Payments & health</h1>
      <div className="panel" style={{ padding: '22px 18px', color: 'var(--muted)', fontSize: 13, maxWidth: 640 }}>
        <div className="tag tag-accent" style={{ marginBottom: 12 }}>Planned</div>
        <p style={{ margin: 0, lineHeight: 1.6 }}>Webhook delivery, background-job queue, provider credential validity, DVA provisioning + reconciliation status.</p>
        <p style={{ marginTop: 10, color: 'var(--faint)' }}>See docs/platform-dashboard-architecture.md for the full spec.</p>
      </div>
    </div>
  )
}
