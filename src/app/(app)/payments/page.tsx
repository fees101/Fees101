import { getPaymentsAnalytics } from '@/lib/queries/analytics'
import CycleSelect from '@/components/payments/CycleSelect'

function formatNaira(amount: number): string {
  return '₦' + Math.round(amount).toLocaleString('en-NG')
}

function RateBar({ rate }: { rate: number }) {
  const capped = Math.min(100, Math.max(0, rate))
  const color = rate >= 80 ? 'bg-mint' : rate >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums w-9 text-right">{rate}%</span>
    </div>
  )
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>
}) {
  const { cycle } = await searchParams
  const data = await getPaymentsAnalytics(cycle)

  if (!data.selectedCycle) {
    return (
      <main className="px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-navy">Payments</h1>
          <p className="mt-4 text-gray-500">
            No billing cycles yet. Create a term and generate invoices to see payment insights here.
          </p>
        </div>
      </main>
    )
  }

  const { summary, byFee, byClass } = data
  const optIns = byFee.filter(f => f.kind === 'opt_in')
  const required = byFee.filter(f => f.kind === 'required')

  return (
    <main className="px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-navy">Payments</h1>
            <p className="text-gray-500 mt-1">
              How {data.selectedCycle.name} is collecting, by fee and by class
            </p>
          </div>
          <CycleSelect cycles={data.cycles} selectedId={data.selectedCycle.id} />
        </header>

        {/* Summary tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-1">Billed</p>
            <p className="text-navy text-2xl font-bold">{formatNaira(summary.billed)}</p>
            <p className="text-gray-500 text-xs mt-2">{summary.invoiceCount} invoices</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-1">Collected</p>
            <p className="text-mint text-2xl font-bold">{formatNaira(summary.collected)}</p>
            <p className="text-gray-500 text-xs mt-2">{summary.collectionRate}% of billed</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-1">Outstanding</p>
            <p className="text-amber-500 text-2xl font-bold">{formatNaira(summary.outstanding)}</p>
            <p className="text-gray-500 text-xs mt-2">Still owed</p>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <p className="text-gray-500 text-sm mb-1">Discounts given</p>
            <p className="text-navy text-2xl font-bold">{formatNaira(summary.discountTotal)}</p>
            <p className="text-gray-500 text-xs mt-2">{formatNaira(summary.creditApplied)} credit applied</p>
          </div>
        </div>

        {/* Revenue by opt-in — the headline: how much each optional fee earns */}
        <section className="mt-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-navy">Revenue by optional fee (opt-ins)</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                e.g. transport, lunch — collected is estimated by how far each invoice is paid
              </p>
            </div>
            {optIns.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">No optional fees billed this term.</p>
            ) : (
              <FeeTable rows={optIns} />
            )}
          </div>
        </section>

        {/* Revenue by required fee */}
        <section className="mt-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-navy">Revenue by required fee</h2>
            </div>
            {required.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">No required fees billed this term.</p>
            ) : (
              <FeeTable rows={required} />
            )}
          </div>
        </section>

        {/* Collection by class */}
        <section className="mt-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-navy">Collection by class</h2>
            </div>
            {byClass.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-500">No invoices this term.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="px-6 py-3 font-semibold">Class</th>
                    <th className="px-6 py-3 font-semibold text-right">Students</th>
                    <th className="px-6 py-3 font-semibold text-right">Billed</th>
                    <th className="px-6 py-3 font-semibold text-right">Collected</th>
                    <th className="px-6 py-3 font-semibold text-right">Outstanding</th>
                    <th className="px-6 py-3 font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {byClass.map(r => (
                    <tr key={r.className} className="hover:bg-gray-50/50">
                      <td className="px-6 py-3 font-medium text-navy">{r.className}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-600">{r.studentsBilled}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-600">{formatNaira(r.billed)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-mint font-medium">{formatNaira(r.collected)}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-amber-600">{formatNaira(r.outstanding)}</td>
                      <td className="px-6 py-3"><RateBar rate={r.rate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function FeeTable({ rows }: { rows: { name: string; studentsBilled: number; billed: number; collected: number; outstanding: number; rate: number }[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-100">
          <th className="px-6 py-3 font-semibold">Fee</th>
          <th className="px-6 py-3 font-semibold text-right">Students</th>
          <th className="px-6 py-3 font-semibold text-right">Billed</th>
          <th className="px-6 py-3 font-semibold text-right">Collected (est.)</th>
          <th className="px-6 py-3 font-semibold text-right">Outstanding</th>
          <th className="px-6 py-3 font-semibold">Rate</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map(r => (
          <tr key={r.name} className="hover:bg-gray-50/50">
            <td className="px-6 py-3 font-medium text-navy">{r.name}</td>
            <td className="px-6 py-3 text-right tabular-nums text-gray-600">{r.studentsBilled}</td>
            <td className="px-6 py-3 text-right tabular-nums text-gray-600">{formatNaira(r.billed)}</td>
            <td className="px-6 py-3 text-right tabular-nums text-mint font-medium">{formatNaira(r.collected)}</td>
            <td className="px-6 py-3 text-right tabular-nums text-amber-600">{formatNaira(r.outstanding)}</td>
            <td className="px-6 py-3"><RateBar rate={r.rate} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
