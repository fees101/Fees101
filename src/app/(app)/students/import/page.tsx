import { redirect } from 'next/navigation'
import CSVImportFlow from '@/components/students/CSVImportFlow'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Import students' }

export default async function ImportStudentsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-students')) {
    return (
      <>
        <WorkspaceHeader workspaceKey="students" title="Students" />
        <AccessDenied ctx={ctx} permissionKey="manage-students" />
      </>
    )
  }

  return (
    <>
      <WorkspaceHeader
        workspaceKey="students"
        title="Students"
      />
      <div className="px-4 sm:px-7 py-7">
        <CSVImportFlow />
      </div>
    </>
  )
}