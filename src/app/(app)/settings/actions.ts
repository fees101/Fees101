'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getContext() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: userProfile } = await supabase
    .from('users')
    .select('school_id, role')
    .eq('id', user.id)
    .single()

  let schoolId = userProfile?.school_id
  if (!schoolId && userProfile?.role === 'super_admin') {
    const { data: firstSchool } = await supabase
      .from('schools')
      .select('id')
      .limit(1)
      .single()
    schoolId = firstSchool?.id
  }
  if (!schoolId) return null

  return { supabase, schoolId }
}

export async function updateSchoolGeneralInfo(form: {
  name: string
  smsShortName: string
  proprietressTitle: string
  proprietressFirstName: string
  proprietressLastName: string
  addressStreet: string
  addressCity: string
  addressState: string
  phone: string
  email: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  if (!form.name.trim()) return { error: 'School name is required' }
  if (form.smsShortName.trim().length > 30) return { error: 'SMS short name must be 30 characters or fewer' }

  const { data: existing } = await supabase
    .from('schools')
    .select('settings')
    .eq('id', schoolId)
    .single()

  const nextSettings = {
    ...(existing?.settings || {}),
    smsShortName: form.smsShortName.trim() || null,
  }

  const { error } = await supabase
    .from('schools')
    .update({
      name: form.name.trim(),
      settings: nextSettings,
      proprietress_title: form.proprietressTitle.trim() || null,
      proprietress_first_name: form.proprietressFirstName.trim() || null,
      proprietress_last_name: form.proprietressLastName.trim() || null,
      address_street: form.addressStreet.trim() || null,
      address_city: form.addressCity.trim() || null,
      address_state: form.addressState.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
    })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  revalidatePath('/invoices')
  return { success: true }
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export async function uploadSchoolLogo(formData: FormData) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'No file selected' }
  }
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { error: 'Logo must be a PNG, JPEG, WebP, or SVG image' }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: 'Logo must be smaller than 2MB' }
  }

  const ext = file.name.split('.').pop() || 'png'
  // Fixed path per school — each new upload overwrites the last, no orphaned files pile up
  const path = `${schoolId}/logo.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('school-logos')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) return { error: uploadError.message }

  const { data: publicUrlData } = supabase.storage
    .from('school-logos')
    .getPublicUrl(path)

  // Cache-bust so the new logo shows immediately even though the path is stable
  const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('schools')
    .update({ logo_url: logoUrl })
    .eq('id', schoolId)

  if (updateError) return { error: updateError.message }

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  revalidatePath('/invoices')
  return { success: true, logoUrl }
}

export async function removeSchoolLogo() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  const { error } = await supabase
    .from('schools')
    .update({ logo_url: null })
    .eq('id', schoolId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  revalidatePath('/invoices')
  return { success: true }
}
