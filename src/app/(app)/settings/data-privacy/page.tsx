import { redirect } from 'next/navigation'
import ComingSoonSettingsPage from '@/components/settings/ComingSoonSettingsPage'
import { getAuthContext } from '@/lib/auth/permissions'

// Exporting/deleting a WHOLE SCHOOL's data is a different risk class from the
// rest of Settings — deliberately hardcoded to the owner (not a togglable
// permission), so a school can't accidentally hand this to a bursar by
// flipping on a settings-management permission.
export default async function DataPrivacySettingsPage() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!ctx.isOwner) redirect('/dashboard')

  return (
    <ComingSoonSettingsPage
      title="Data & privacy"
      subtitle="How school and parent data is handled"
      icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      description="Export or delete school data, and review what information is stored about students and parents."
    />
  )
}
