import { redirect } from 'next/navigation'
import { getStudents, STUDENTS_PAGE_SIZE_OPTIONS, type StudentSortKey, type StudentSortDir } from '@/lib/queries/students'
import StudentsTable from '@/components/students/StudentsTable'
import StudentsHeader from '@/components/students/StudentsHeader'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Students' }

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
  if (!can(ctx, 'see-students')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="students" title="Students" />
        <AccessDenied ctx={ctx} permissionKey="see-students" />
      </>
    )
  }

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
  const invoiceStatus = (
    sp.invoiceStatus === 'owing' ||
    sp.invoiceStatus === 'not_billed' ||
    sp.invoiceStatus === 'paid' ||
    sp.invoiceStatus === 'partial' ||
    sp.invoiceStatus === 'pending' ||
    sp.invoiceStatus === 'no_invoice'
  )
    ? sp.invoiceStatus
    : 'all'
  const sortKey = SORT_KEYS.includes(sp.sort as StudentSortKey) ? (sp.sort as StudentSortKey) : 'class'
  const sortDir: StudentSortDir = sp.dir === 'desc' ? 'desc' : 'asc'

  const { students, classes, statusCounts, invoiceCounts, total } = await getStudents({
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
    <>
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

      <StudentsHeader classes={classes} />

      <div className="px-4 sm:px-7 py-7">
        <StudentsTable
          students={students}
          classes={classes}
          total={total}
          page={page}
          perPage={perPage}
          search={search}
          classId={classId}
          invoiceStatus={invoiceStatus}
          statusFilter={validStatus}
          statusCounts={statusCounts}
          invoiceCounts={invoiceCounts}
          sortKey={sortKey}
          sortDir={sortDir}
        />
      </div>
    </>
  )
}
