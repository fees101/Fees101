import Link from 'next/link'
import { getClasses } from '@/lib/queries/fees'
import ClassesTable from '@/components/ClassesTable'

export default async function ClassesPage() {
  const { classes, sections } = await getClasses()

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        {/* Breadcrumb */}
        <nav className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/fees" className="hover:text-navy">Fees</Link>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-navy font-medium">Classes</span>
        </nav>

        <ClassesTable classes={classes} sections={sections} />

      </div>
    </main>
  )
}