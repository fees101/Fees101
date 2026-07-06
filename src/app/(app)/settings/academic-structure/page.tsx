import { getClasses, getSessions, getAllCycles } from '@/lib/queries/fees'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import AcademicStructureLayout from '@/components/settings/AcademicStructureLayout'

export default async function AcademicStructurePage() {
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
