import { redirect } from 'next/navigation'
import InvoicesListLayout from '@/components/invoices/InvoicesListLayout'
import { getAllInvoices } from '@/lib/queries/fees'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function InvoicesPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-invoices')) redirect('/dashboard')

  const invoices = await getAllInvoices()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        <InvoicesListLayout invoices={invoices} />
      </div>
    </main>
  )
}
