import { redirect } from 'next/navigation'
import { getPlatformAdmin } from '@/lib/auth'
import OnboardingForm from './OnboardingForm'

export default async function OnboardingPage() {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  return (
    <div>
      <div className="kicker">Onboarding</div>
      <h1 style={{ fontSize: 24, marginTop: 6, marginBottom: 14 }}>Onboard a school</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, maxWidth: 480 }}>
        Creates the school and the owner&rsquo;s login. Everything else &mdash; academic structure, fee items, payment provider, staff &mdash; the school sets up itself once they&rsquo;re in.
      </p>
      <OnboardingForm />
    </div>
  )
}
