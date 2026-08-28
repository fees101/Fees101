import { redirect } from 'next/navigation'
import { getAuthContext, can } from '@/lib/auth/permissions'
import { getAuditLog } from '@/lib/audit/auditLog'
import { AUDIT_LOG_GROUPS } from '@/lib/audit/auditLogGroups'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AuditLogTable from '@/components/settings/AuditLogTable'

const PAGE_SIZE_OPTIONS = [50, 100, 200]

// Gated on its own 'see-audit-log' permission (owner/super_admin/is_admin
// bypass) — kept separate from manage-school-profile so an owner can grant
// audit visibility without granting school-profile edit rights.
export default async function AuditLogSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; perPage?: string; group?: string; from?: string; to?: string }>
}) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'see-audit-log')) redirect('/dashboard')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const perPage = PAGE_SIZE_OPTIONS.includes(Number(sp.perPage)) ? Number(sp.perPage) : PAGE_SIZE_OPTIONS[0]
  const group = sp.group || 'all'
  const prefixes = AUDIT_LOG_GROUPS.find(g => g.label === group)?.prefixes

  const { events, total } = await getAuditLog({
    limit: perPage,
    offset: (page - 1) * perPage,
    actionPrefixes: prefixes,
    from: sp.from,
    to: sp.to,
  })

  return (
    <SettingsPageShell
      title="Audit log"
      subtitle="A history of the actions staff have taken in this account — staff, role, student, fee, discount and settings changes"
    >
      <AuditLogTable
        events={events}
        total={total}
        page={page}
        perPage={perPage}
        group={group}
        from={sp.from || ''}
        to={sp.to || ''}
      />
    </SettingsPageShell>
  )
}
