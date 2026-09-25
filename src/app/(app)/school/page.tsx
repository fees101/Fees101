import { notFound, redirect } from 'next/navigation'
import SettingsPageShell from '@/components/settings/SettingsPageShell'
import SchoolProfileForm from '@/components/settings/SchoolProfileForm'
import RealtimeRefresh from '@/components/realtime/RealtimeRefresh'
import AccessDenied from '@/components/layout/AccessDenied'
import { getSchoolSettings } from '@/lib/queries/school'
import { getAuthContext, can } from '@/lib/auth/permissions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'School profile' }

interface PageProps {
  searchParams: Promise<{ emailVerify?: string }>
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/login')
  if (!can(ctx, 'manage-school-profile')) {
    return (
      <SettingsPageShell workspaceKey="school" title="School profile">
        <AccessDenied ctx={ctx} permissionKey="manage-school-profile" padded={false} />
      </SettingsPageShell>
    )
  }

  const school = await getSchoolSettings()
  if (!school) notFound()

  const { data: actor } = await ctx.supabase.from('users').select('name').eq('id', ctx.userId).maybeSingle()
  const { emailVerify } = await searchParams

  return (
    <SettingsPageShell workspaceKey="school" title="School profile">
      {ctx.schoolId && (
        // School profile lives on the school row; another admin editing it refreshes here.
        <RealtimeRefresh subscriptions={[{ table: 'schools', filter: `id=eq.${ctx.schoolId}` }]} />
      )}
      <SchoolProfileForm school={school} actorName={actor?.name || 'You'} emailVerifyResult={emailVerify} />
    </SettingsPageShell>
  )
}
