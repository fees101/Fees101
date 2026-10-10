import { redirect } from 'next/navigation'
import { getPlatformAdmin } from '@/lib/auth'
import Rail from '@/components/Rail'
import ThemeToggle from '@/components/ThemeToggle'

// Wraps every authenticated console page (NOT /login, which sits outside this
// route group). Single place that enforces platform-admin auth + renders the
// shell (left rail + top bar). See docs/platform-dashboard-architecture.md §3–4.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await getPlatformAdmin()
  if (!admin) redirect('/login')

  const isTest = (process.env.PAYSTACK_SECRET_KEY || '').startsWith('sk_test')

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em' }}>Fees101</span>
            <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 11, letterSpacing: '0.12em' }}>CONSOLE</span>
          </div>
          <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 3 }}>Control plane</div>
        </div>
        <Rail />
      </aside>

      <div>
        <header className="topbar">
          <span className={`env-chip${isTest ? '' : ' live'}`}>{isTest ? 'Test' : 'Live'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{admin.name || admin.email}</span>
            <span className="tag tag-accent">{admin.role}</span>
            <ThemeToggle />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
