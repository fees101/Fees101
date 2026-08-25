import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface SchoolSettings {
  id: string
  name: string
  smsShortName: string | null
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
  const ctx = await getAuthContext()
  return ctx?.schoolId ?? null
}

export async function getSchoolSettings(): Promise<SchoolSettings | null> {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return null

  const { data: school } = await supabase
    .from('schools')
    .select(`
      id, name, logo_url, phone, email, subscription_status, settings,
      address_street, address_city, address_state,
      proprietress_title, proprietress_first_name, proprietress_last_name
    `)
    .eq('id', schoolId)
    .single()

  if (!school) return null

  return {
    id: school.id,
    name: school.name,
    smsShortName: school.settings?.smsShortName || null,
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
