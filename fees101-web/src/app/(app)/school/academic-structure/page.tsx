import { redirect } from 'next/navigation'
import { getClasses, getSessions, getAllCycles } from '@/lib/queries/fees'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AcademicStructureLayout from '@/components/settings/academic-structure/AcademicStructureLayout'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Academic structure' }

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayMonth(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

export default async function AcademicStructurePage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-academic-structure')) {
    return (
      <SettingsPageShell workspaceKey="school" title="Academic structure">
        <AccessDenied ctx={ctx} permissionKey="manage-academic-structure" padded={false} />
      </SettingsPageShell>
    )
  }

  const [{ classes, sections }, sessions, cycles] = await Promise.all([
    getClasses(),
    getSessions(),
    getAllCycles(),
  ])

  const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()

  const termCounts: Record<string, number> = {}
  cycles.forEach(c => {
    if (c.sessionId) termCounts[c.sessionId] = (termCounts[c.sessionId] || 0) + 1
  })

  // ---- Summary values for the ledger ----
  const activeSession = sessions.find(s => s.status === 'active') || null

  const activeClasses = classes
    .filter(c => c.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder)
  const classesRange =
    activeClasses.length === 0
      ? null
      : activeClasses.length === 1
        ? activeClasses[0].name
        : `${activeClasses[0].name} through ${activeClasses[activeClasses.length - 1].name}`
  const classesValue = classesRange ? `${activeClasses.length} · ${classesRange}` : null

  const activeCycle = cycles.find(c => c.status === 'active') || null
  const currentTermClose = activeCycle ? dayMonth(activeCycle.endDate) : null
  const currentTermValue = activeCycle
    ? currentTermClose
      ? `${activeCycle.name} · closes ${currentTermClose}`
      : activeCycle.name
    : null

  // Terms of the active session, for the Terms drill-in (read-only summary;
  // full CRUD stays on the Billing cycles page).
  const terms = cycles
    .filter(c => (activeSession ? c.sessionId === activeSession.id : false))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      closeLabel: dayMonth(c.endDate),
    }))

  const summary = {
    classesValue,
    sessionValue: activeSession?.name || null,
    currentTermValue,
  }

  return (
    <SettingsPageShell workspaceKey="school" title="Academic structure">
      {ctx.schoolId && (
        // Structure changed by the year-end rollover job or another admin.
        <RealtimeRefresh
          subscriptions={[
            { table: 'classes', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'sections', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'sessions', filter: `school_id=eq.${ctx.schoolId}` },
            { table: 'billing_cycles', filter: `school_id=eq.${ctx.schoolId}` },
          ]}
        />
      )}
      <AcademicStructureLayout
        classes={classes}
        sections={sections}
        sessions={sessions}
        termCounts={termCounts}
        activeSessionName={activeSession?.name || null}
        terms={terms}
        summary={summary}
        actorName={actor?.name || 'You'}
      />
    </SettingsPageShell>
  )
}
