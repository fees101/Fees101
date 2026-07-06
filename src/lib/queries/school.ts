import { createClient } from '@/lib/supabase/server'

export interface SchoolSettings {
  id: string
  name: string
  logoUrl: string | null
  addressStreet: string | null
  addressCity: string | null
  addressState: string | null
  phone: string | null
  email: string | null
  proprietressTitle: string | null
  proprietressFirstName: string | null
  proprietressLastName: string | null
  subscriptionStatus: string
}

async function getSchoolId() {
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
  return schoolId
}

export async function getSchoolSettings(): Promise<SchoolSettings | null> {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return null

  const { data: school } = await supabase
    .from('schools')
    .select(`
      id, name, logo_url, phone, email, subscription_status,
      address_street, address_city, address_state,
      proprietress_title, proprietress_first_name, proprietress_last_name
    `)
    .eq('id', schoolId)
    .single()

  if (!school) return null

  return {
    id: school.id,
    name: school.name,
    logoUrl: school.logo_url,
    addressStreet: school.address_street,
    addressCity: school.address_city,
    addressState: school.address_state,
    phone: school.phone,
    email: school.email,
    proprietressTitle: school.proprietress_title,
    proprietressFirstName: school.proprietress_first_name,
    proprietressLastName: school.proprietress_last_name,
    subscriptionStatus: school.subscription_status,
  }
}
