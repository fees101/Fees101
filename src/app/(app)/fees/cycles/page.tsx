import Link from 'next/link'
import { redirect } from 'next/navigation'
import CyclesLayout from '@/components/fees/CyclesLayout'
import { getAllCycles, getSessions } from '@/lib/queries/fees'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function CyclesPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-fee-structure')) redirect('/fees')
  const showFinancials = can(ctx, 'see-financial-totals')

  const [cycles, sessions] = await Promise.all([
    getAllCycles(),
    getSessions(),
  ])

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/fees" className="hover:text-navy">Fees</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-navy font-medium">Billing cycles</span>
        </nav>

        <CyclesLayout cycles={cycles} sessions={sessions} showFinancials={showFinancials} />

      </div>
    </main>
  )
}