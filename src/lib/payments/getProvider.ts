import { createClient } from '@/lib/supabase/server'
import { decryptCredential } from './encryption'
import { MonnifyProvider } from './monnify'
import { PaymentProvider } from './types'

// Accepts an optional Supabase client so callers with no user session (the
// webhook handler, running with no auth.uid()) can pass in a service-role
// client instead of the normal RLS-scoped one.
export async function getPaymentProviderForSchool(
  schoolId: string,
  supabaseClient?: any
): Promise<PaymentProvider | null> {
  const supabase = supabaseClient || await createClient()

  const { data: school } = await supabase
    .from('schools')
    .select('payment_provider, provider_api_key, provider_secret_key, provider_contract_code')
    .eq('id', schoolId)
    .single()

  if (!school?.payment_provider || !school.provider_api_key || !school.provider_secret_key || !school.provider_contract_code) {
    return null
  }

  const credentials = {
    apiKey: decryptCredential(school.provider_api_key),
    secretKey: decryptCredential(school.provider_secret_key),
    contractCode: school.provider_contract_code,
  }

  switch (school.payment_provider) {
    case 'monnify':
      return new MonnifyProvider(credentials)
    default:
      return null
  }
}
