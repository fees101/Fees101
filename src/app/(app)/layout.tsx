import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppNav from '@/components/AppNav'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('name, email, role, school_id, schools(name)')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  // For super_admin, fall back to first school
  let schoolId = profile.school_id
  if (!schoolId && profile.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }

  // Fetch current term for the nav
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('name')
    .eq('school_id', schoolId || '')
    .in('status', ['active', 'draft'])
    .order('start_date', { ascending: false })
    .limit(1)
    .single()

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav 
        userName={profile.name}
        userEmail={profile.email}
        userRole={profile.role}
        // @ts-expect-error — schools is joined object
        schoolName={profile.schools?.name || 'Fees101'}
        currentTermName={currentCycle?.name || 'No active term'}
      />
      <main>{children}</main>
    </div>
  )
}