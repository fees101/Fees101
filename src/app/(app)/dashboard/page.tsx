import { createClient } from '@/lib/supabase/server'
import { getDashboardKPIs, getCollectionByClass } from '@/lib/queries/dashboard'
import CollectionChart from '@/components/CollectionChart'

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

  return (
    <main className="p-10">
      <div className="max-w-7xl mx-auto">
        
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-navy">
            {getGreeting()}, {firstName}
          </h1>
          <p className="text-gray-500 mt-2">
            Here's how {kpis.currentCycleName} is going
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-2">Total Expected</p>
            <p className="text-navy text-2xl font-bold">{formatNaira(kpis.totalExpected)}</p>
            <p className="text-gray-500 text-xs mt-2">{kpis.studentsCount} students</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-2">Total Collected</p>
            <p className="text-mint text-2xl font-bold">{formatNaira(kpis.totalCollected)}</p>
            <p className="text-gray-500 text-xs mt-2">{kpis.collectionPercentage}% of expected</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-2">Outstanding</p>
            <p className="text-amber-500 text-2xl font-bold">{formatNaira(kpis.totalOutstanding)}</p>
            <p className="text-gray-500 text-xs mt-2">Awaiting payment</p>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-2">Pending Approvals</p>
            <p className="text-navy text-2xl font-bold">{kpis.pendingApprovalsCount}</p>
            <p className="text-gray-500 text-xs mt-2">Need your review</p>
          </div>

        </div>
        
        <div className="mt-8">
          <CollectionChart data={classData} />
        </div>
      </div>
    </main>
  )
}