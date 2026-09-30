import { createClient } from '@/lib/supabase/server'
import { getAuthContext } from '@/lib/auth/permissions'

export interface PaymentSettings {
  schoolId: string
  provider: string | null
  contractCode: string | null
  // Which environment the saved keys point at. The keys alone don't reliably
  // say (only Paystack keys carry a live/test prefix), so the school states it.
  mode: 'test' | 'live'
  // We never send the encrypted credential blobs to the client — only whether
  // they are set, so the form can show "saved" without exposing anything.
  hasApiKey: boolean
  hasSecretKey: boolean
  // True once every piece the payment engine needs is present.
  isConfigured: boolean
  // Key lifecycle for the API-keys ledger row.
  keysVerifiedAt: string | null
  keysRotatedAt: string | null
  // "you" when the current user rotated them, otherwise the rotator's name.
  keysRotatedByLabel: string | null
  // How many students already have a virtual account — a live signal that
  // payments are working end-to-end.
  dvaCount: number
  // Active students still missing an account — drives the bulk "create all" button.
  studentsWithoutDvaCount: number
  // When reconciliation last swept, for the "last run" marker on that row.
  lastReconciledAt: string | null
}

export async function getPaymentSettings(): Promise<PaymentSettings | null> {
  const supabase = await createClient()
  const ctx = await getAuthContext()
  const schoolId = ctx?.schoolId ?? null
  if (!schoolId) return null

  // All three are independent (the counts key off schoolId, not the school
  // row), so they run together instead of stacking three round-trips.
  const [{ data: school }, { count }, { count: withoutDva }] = await Promise.all([
    supabase
      .from('schools')
      .select(
        'payment_provider, provider_api_key, provider_secret_key, provider_contract_code, payment_mode, keys_verified_at, keys_rotated_at, keys_rotated_by, last_reconciled_at',
      )
      .eq('id', schoolId)
      .single(),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .not('provider_dva_account_number', 'is', null),
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .is('provider_dva_reference', null),
  ])

  if (!school) return null

  const hasApiKey = !!school.provider_api_key
  const hasSecretKey = !!school.provider_secret_key
  // Monnify additionally needs a contract code; Paystack does not.
  const hasContractCode = school.payment_provider === 'monnify' ? !!school.provider_contract_code : true
  const isConfigured = !!school.payment_provider && hasApiKey && hasSecretKey && hasContractCode

  // Resolve who last rotated the keys to a label ("you" or their name). Only
  // one extra round-trip, and only when a rotation has actually happened.
  let keysRotatedByLabel: string | null = null
  if (school.keys_rotated_by) {
    if (school.keys_rotated_by === ctx?.userId) {
      keysRotatedByLabel = 'you'
    } else {
      const { data: rotator } = await supabase
        .from('users')
        .select('name')
        .eq('id', school.keys_rotated_by)
        .single()
      keysRotatedByLabel = rotator?.name ?? 'another admin'
    }
  }

  return {
    schoolId,
    provider: school.payment_provider ?? null,
    contractCode: school.provider_contract_code ?? null,
    mode: school.payment_mode === 'live' ? 'live' : 'test',
    hasApiKey,
    hasSecretKey,
    isConfigured,
    keysVerifiedAt: school.keys_verified_at ?? null,
    keysRotatedAt: school.keys_rotated_at ?? null,
    keysRotatedByLabel,
    dvaCount: count ?? 0,
    studentsWithoutDvaCount: withoutDva ?? 0,
    lastReconciledAt: school.last_reconciled_at ?? null,
  }
}
