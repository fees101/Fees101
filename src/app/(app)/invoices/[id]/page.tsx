import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getInvoiceById } from '@/lib/queries/fees'
import InvoiceDetailLayout from '@/components/invoices/InvoiceDetailLayout'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const { id } = await params
  const invoice = await getInvoiceById(id)

  if (!invoice) notFound()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/fees" className="hover:text-navy">Fees</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <Link href="/fees/cycles" className="hover:text-navy">Billing cycles</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <Link href={`/fees/cycles/${invoice.cycleId}`} className="hover:text-navy">
            {invoice.cycleName}
          </Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-navy font-medium">
            {invoice.studentFirstName} {invoice.studentLastName}
          </span>
        </nav>

        <InvoiceDetailLayout invoice={invoice} />

      </div>
    </main>
  )
}