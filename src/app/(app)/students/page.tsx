import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getStudents } from '@/lib/queries/students'
import StudentsTable from '@/components/students/StudentsTable'
import StudentsHeader from '@/components/students/StudentsHeader'
import { getAuthContext, can } from '@/lib/auth/permissions'

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function StudentsPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-students')) redirect('/dashboard')

  const { status } = await searchParams
  const validStatus = (status === 'withdrawn' || status === 'graduated' || status === 'all') 
    ? status 
    : 'active'
  
  const { students, classes, currentTermName, classCount, statusCounts, paymentsConfigured, studentsWithoutDvaCount } = await getStudents(validStatus)

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        <StudentsHeader
          studentCount={students.length}
          classCount={classCount}
          currentTermName={currentTermName}
          classes={classes}
          statusCounts={statusCounts}
          activeStatusFilter={validStatus}
        />

        {paymentsConfigured && studentsWithoutDvaCount > 0 && can(ctx, 'manage-payment-config') && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12a2 2 0 00-3.48 0l-7.07 12a2 2 0 001.74 3z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {studentsWithoutDvaCount} active {studentsWithoutDvaCount === 1 ? 'student doesn’t' : 'students don’t'} have a payment account yet
                </p>
                <p className="text-sm text-amber-700 mt-0.5">Parents can only pay by transfer once each student has a virtual account.</p>
              </div>
            </div>
            <Link
              href="/settings/payments"
              className="flex-shrink-0 px-4 py-2 bg-mint text-navy text-sm font-semibold rounded-lg hover:bg-mint/90 text-center"
            >
              Create accounts
            </Link>
          </div>
        )}

        <StudentsTable students={students} classes={classes} />

      </div>
    </main>
  )
}