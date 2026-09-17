import { redirect } from 'next/navigation'
import { getStudents, STUDENTS_PAGE_SIZE_OPTIONS, type StudentSortKey, type StudentSortDir } from '@/lib/queries/students'
import StudentsTable from '@/components/students/StudentsTable'
import StudentsHeader from '@/components/students/StudentsHeader'
import PaymentAccountsBanner from '@/components/students/PaymentAccountsBanner'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import { getAuthContext, can } from '@/lib/auth/permissions'

interface PageProps {
  searchParams: Promise<{
    status?: string
    page?: string
    perPage?: string
    search?: string
    class?: string
    invoiceStatus?: string
    sort?: string
    dir?: string
  }>
}

const SORT_KEYS: StudentSortKey[] = ['class', 'name', 'parent', 'phone', 'total', 'paid', 'status']

export default async function StudentsPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-students')) redirect('/dashboard')

  const sp = await searchParams
  const validStatus = (sp.status === 'withdrawn' || sp.status === 'graduated' || sp.status === 'all')
    ? sp.status
    : 'active'
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const perPage = STUDENTS_PAGE_SIZE_OPTIONS.includes(parseInt(sp.perPage || '', 10))
    ? parseInt(sp.perPage as string, 10)
    : 50
  const search = sp.search || ''
  const classId = sp.class || 'all'
  const invoiceStatus = (sp.invoiceStatus === 'paid' || sp.invoiceStatus === 'partial' || sp.invoiceStatus === 'pending' || sp.invoiceStatus === 'no_invoice')
    ? sp.invoiceStatus
    : 'all'
  const sortKey = SORT_KEYS.includes(sp.sort as StudentSortKey) ? (sp.sort as StudentSortKey) : 'class'
  const sortDir: StudentSortDir = sp.dir === 'desc' ? 'desc' : 'asc'

  const { students, classes, currentTermName, classCount, statusCounts, paymentsConfigured, studentsWithoutDvaCount, total } = await getStudents({
    statusFilter: validStatus,
    search,
    classId,
    invoiceStatus,
    sortKey,
    sortDir,
    page,
    perPage,
  })

  return (
    <main className="px-6 py-6">
      <div className="max-w-[1440px] mx-auto">

        {ctx.schoolId && (
          <RealtimeRefresh
            subscriptions={[
              // Roster balances/status move on payment webhooks (payments),
              // invoice generation (invoices) and DVA provisioning / other
              // staff edits (students) — all school-scoped, all published.
              { table: 'students', filter: `school_id=eq.${ctx.schoolId}` },
              { table: 'invoices', filter: `school_id=eq.${ctx.schoolId}` },
              { table: 'payments', filter: `school_id=eq.${ctx.schoolId}` },
            ]}
          />
        )}

        <StudentsHeader
          studentCount={total}
          classCount={classCount}
          currentTermName={currentTermName}
          classes={classes}
          statusCounts={statusCounts}
          activeStatusFilter={validStatus}
        />

        {paymentsConfigured && can(ctx, 'manage-payment-config') && (
          <PaymentAccountsBanner studentsWithoutDvaCount={studentsWithoutDvaCount} />
        )}

        <StudentsTable
          students={students}
          classes={classes}
          total={total}
          page={page}
          perPage={perPage}
          search={search}
          classId={classId}
          invoiceStatus={invoiceStatus}
          sortKey={sortKey}
          sortDir={sortDir}
        />

      </div>
    </main>
  )
}
