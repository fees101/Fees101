import InvoicesListLayout from '@/components/InvoicesListLayout'
import { getAllInvoices } from '@/lib/queries/fees'

export default async function InvoicesPage() {
  const invoices = await getAllInvoices()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">
        <InvoicesListLayout invoices={invoices} />
      </div>
    </main>
  )
}
