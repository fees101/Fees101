import { redirect } from 'next/navigation'
import WorkspaceHeader from '@/components/layout/WorkspaceHeader'
import AccessDenied from '@/components/layout/AccessDenied'
import FamilyAccountsTable from '@/components/students/FamilyAccountsTable'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getFamilyAccounts, type FamilyDvaFilter } from '@/lib/queries/families'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Family accounts' }

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function FamilyAccountsPage({ searchParams }: PageProps) {
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

  const sp = await searchParams
  const rawFilter = typeof sp.filter === 'string' ? sp.filter : 'all'
  const filter: FamilyDvaFilter = rawFilter === 'on' || rawFilter === 'off' ? rawFilter : 'all'
  const search = typeof sp.q === 'string' ? sp.q : ''
  const page = Math.max(1, Number(sp.page) || 1)
  const perPage = [25, 50, 100].includes(Number(sp.perPage)) ? Number(sp.perPage) : 25

  const result = await getFamilyAccounts({ search, filter, page, perPage })

  return (
    <>
      <WorkspaceHeader workspaceKey="students" title="Students" />
      <FamilyAccountsTable
        rows={result?.rows ?? []}
        total={result?.total ?? 0}
        page={page}
        perPage={perPage}
        counts={result?.counts ?? { all: 0, on: 0, off: 0 }}
        filter={filter}
        search={search}
      />
    </>
  )
}
