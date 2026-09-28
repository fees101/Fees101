export default function SettingsPage() {
  return (
    <div>
      <div className="kicker">Settings</div>
      <h1 style={{ fontSize: 24, marginTop: 6, marginBottom: 14 }}>Settings</h1>
      <div className="panel" style={{ padding: '22px 18px', color: 'var(--muted)', fontSize: 13, maxWidth: 640 }}>
        <div className="tag tag-accent" style={{ marginBottom: 12 }}>Planned</div>
        <p style={{ margin: 0, lineHeight: 1.6 }}>Platform admins & roles, platform Paystack config, billing defaults, school-facing message templates.</p>
        <p style={{ marginTop: 10, color: 'var(--faint)' }}>See docs/platform-dashboard-architecture.md for the full spec.</p>
      </div>
    </div>
  )
}
