import { redirect } from 'next/navigation'
import { getStudents } from '@/lib/queries/students'
import StudentsTable from '@/components/students/StudentsTable'
import StudentsHeader from '@/components/students/StudentsHeader'
import PaymentAccountsBanner from '@/components/students/PaymentAccountsBanner'
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

        {paymentsConfigured && can(ctx, 'manage-payment-config') && (
          <PaymentAccountsBanner studentsWithoutDvaCount={studentsWithoutDvaCount} />
        )}

        <StudentsTable students={students} classes={classes} />

      </div>
    </main>
  )
}