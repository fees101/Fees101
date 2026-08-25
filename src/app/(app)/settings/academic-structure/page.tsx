import { redirect } from 'next/navigation'
import { getClasses, getSessions, getAllCycles } from '@/lib/queries/fees'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AcademicStructureLayout from '@/components/settings/academic-structure/AcademicStructureLayout'
import { getAuthContext, can } from '@/lib/auth/permissions'

export default async function AcademicStructurePage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-academic-structure')) redirect('/dashboard')

  const [{ classes, sections }, sessions, cycles] = await Promise.all([
    getClasses(),
    getSessions(),
    getAllCycles(),
  ])

  const classCounts: Record<string, number> = {}
  classes.forEach(c => {
    classCounts[c.sectionId] = (classCounts[c.sectionId] || 0) + 1
  })

  const termCounts: Record<string, number> = {}
  cycles.forEach(c => {
    if (c.sessionId) termCounts[c.sessionId] = (termCounts[c.sessionId] || 0) + 1
  })

  return (
    <SettingsPageShell title="Academic structure" subtitle="Sessions, sections, and classes">
      <AcademicStructureLayout
        classes={classes}
        sections={sections}
        sessions={sessions}
        classCounts={classCounts}
        termCounts={termCounts}
      />
    </SettingsPageShell>
  )
}
