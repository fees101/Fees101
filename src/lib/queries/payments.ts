import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface PaymentSettings {
  schoolId: string
  provider: string | null
  contractCode: string | null
  // We never send the encrypted credential blobs to the client — only whether
  // they are set, so the form can show "saved" without exposing anything.
  hasApiKey: boolean
  hasSecretKey: boolean
  // True once every piece the payment engine needs is present.
  isConfigured: boolean
  // How many students already have a virtual account — a live signal that
  // payments are working end-to-end.
  dvaCount: number
  // Active students still missing an account — drives the bulk "create all" button.
  studentsWithoutDvaCount: number
}

async function getSchoolId() {
  const ctx = await getAuthContext()
  return ctx?.schoolId ?? null
}

export async function getPaymentSettings(): Promise<PaymentSettings | null> {
  const supabase = await createClient()
  const schoolId = await getSchoolId()
  if (!schoolId) return null

  const { data: school } = await supabase
    .from('schools')
    .select('payment_provider, provider_api_key, provider_secret_key, provider_contract_code')
    .eq('id', schoolId)
    .single()

  if (!school) return null

  const hasApiKey = !!school.provider_api_key
  const hasSecretKey = !!school.provider_secret_key
  const isConfigured = !!school.payment_provider && hasApiKey && hasSecretKey && !!school.provider_contract_code

  const { count } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .not('provider_dva_account_number', 'is', null)

  const { count: withoutDva } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)

  return {
    schoolId,
    provider: school.payment_provider ?? null,
    contractCode: school.provider_contract_code ?? null,
    hasApiKey,
    hasSecretKey,
    isConfigured,
    dvaCount: count ?? 0,
    studentsWithoutDvaCount: withoutDva ?? 0,
  }
}
