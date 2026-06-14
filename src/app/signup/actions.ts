'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const name = formData.get('name') as string
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // Create auth user
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ 
    email, 
    password,
    options: {
      data: { name }
    }
  })

  if (signUpError) {
    return { error: signUpError.message }
  }

  if (!signUpData.user) {
    return { error: 'Signup succeeded but no user returned.' }
  }

  // Sign in immediately to establish session
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (signInError) {
    return { error: `Account created. Please sign in: ${signInError.message}` }
  }

  // Now session is active, INSERT will pass RLS
  const { error: profileError } = await supabase
    .from('users')
    .insert({
      id: signUpData.user.id,
      name,
      email,
      role: 'super_admin',
      school_id: null,
    })

  if (profileError) {
    return { error: `Profile setup failed: ${profileError.message}` }
  }

  redirect('/dashboard')
}