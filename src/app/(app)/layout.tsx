import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppNav from '@/components/AppNav'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Verify user is authenticated
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch user profile (name, role, school_id)
  const { data: profile } = await supabase
    .from('users')
    .select('name, email, role, school_id, schools(name)')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav 
        userName={profile.name}
        userEmail={profile.email}
        userRole={profile.role}
        // @ts-expect-error — schools is joined object
        schoolName={profile.schools?.name || 'Fees101'}
      />
      <main>{children}</main>
    </div>
  )
}