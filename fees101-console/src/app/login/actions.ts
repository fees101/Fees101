'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

export async function login(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) return { error: 'Invalid email or password.' }

  const service = createServiceRoleClient()
  const { data: admin } = await service.from('platform_admins').select('id').eq('id', data.user.id).maybeSingle()
  if (!admin) {
    await supabase.auth.signOut()
    return { error: 'This account is not allowlisted for the platform dashboard. Add it to platform_admins first.' }
  }

  redirect('/schools')
}
