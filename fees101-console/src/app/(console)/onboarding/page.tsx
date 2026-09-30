export default function OnboardingPage() {
  return (
    <div>
      <div className="kicker">Onboarding</div>
      <h1 style={{ fontSize: 24, marginTop: 6, marginBottom: 14 }}>Onboarding</h1>
      <div className="panel" style={{ padding: '22px 18px', color: 'var(--muted)', fontSize: 13, maxWidth: 640 }}>
        <div className="tag tag-accent" style={{ marginBottom: 12 }}>Planned</div>
        <p style={{ margin: 0, lineHeight: 1.6 }}>Create a new school tenant (seeds default roles, sets the billing cycle anchor, provisions the Fees101 billing DVA).</p>
        <p style={{ marginTop: 10, color: 'var(--faint)' }}>See docs/platform-dashboard-architecture.md for the full spec.</p>
      </div>
    </div>
  )
}
