export default function AuditPage() {
  return (
    <div>
      <div className="kicker">Audit log</div>
      <h1 style={{ fontSize: 24, marginTop: 6, marginBottom: 14 }}>Audit log</h1>
      <div className="panel" style={{ padding: '22px 18px', color: 'var(--muted)', fontSize: 13, maxWidth: 640 }}>
        <div className="tag tag-accent" style={{ marginBottom: 12 }}>Planned</div>
        <p style={{ margin: 0, lineHeight: 1.6 }}>Cross-tenant founder/internal actions (suspend, edit billing, impersonate, clear DVA, onboard).</p>
        <p style={{ marginTop: 10, color: 'var(--faint)' }}>See docs/platform-dashboard-architecture.md for the full spec.</p>
      </div>
    </div>
  )
}
