import { createClient } from '@/lib/supabase/server'
import { getDashboardKPIs, getCollectionByClass, getRecentActivity } from '@/lib/queries/dashboard'
import CollectionChart from '@/components/CollectionChart'
import RecentActivity from '@/components/RecentActivity'

function formatNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG')
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default async function Dashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('users')
    .select('name')
    .eq('id', user!.id)
    .single()

  const firstName = profile?.name?.split(' ')[0] || 'there'
  const kpis = await getDashboardKPIs()
  const classData = await getCollectionByClass()
  const activity = await getRecentActivity(6)

  return (
    <main className="px-6 py-6">
      <div className="max-w-7xl mx-auto">
        
        <header className="mb-3">
          <h1 className="text-3xl font-bold text-navy">
            {getGreeting()}, {firstName}
          </h1>
          <p className="text-gray-500 mt-1">
            Here's how {kpis.currentCycleName} is going
          </p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Total Expected</p>
                <p className="text-navy text-2xl font-bold">{formatNaira(kpis.totalExpected)}</p>
                <p className="text-gray-500 text-xs mt-2">{kpis.studentsCount} students</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Total Collected</p>
                <p className="text-mint text-2xl font-bold">{formatNaira(kpis.totalCollected)}</p>
                <p className="text-gray-500 text-xs mt-2">{kpis.collectionPercentage}% of expected</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-mint-light flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-mint" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="14" width="3" height="7" rx="0.5" />
                  <rect x="9" y="10" width="3" height="11" rx="0.5" />
                  <rect x="15" y="6" width="3" height="15" rx="0.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 11l6-6 4 4 8-8" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 1h4v4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Outstanding</p>
                <p className="text-amber-500 text-2xl font-bold">{formatNaira(kpis.totalOutstanding)}</p>
                <p className="text-gray-500 text-xs mt-2">Awaiting payment</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Pending Approvals</p>
                <p className="text-navy text-2xl font-bold">{kpis.pendingApprovalsCount}</p>
                <p className="text-gray-500 text-xs mt-2">Need your review</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

        </div>
        
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <CollectionChart data={classData} />
          </div>
          <div className="lg:col-span-2">
            <RecentActivity events={activity} />
          </div>
        </div>

      </div>
    </main>
  )
}