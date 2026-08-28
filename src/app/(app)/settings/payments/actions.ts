'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { encryptCredential } from '@/lib/payments/encryption'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { logAuditEvent } from '@/lib/audit/logAudit'

// Providers wired into getProvider(). Guard against anything else so we never
// save a provider the engine can't actually use.
const SUPPORTED_PROVIDERS = ['monnify', 'paystack']

async function getContext() {
  // Gated on the 'manage-payment-config' permission (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-payment-config')
  if (!ctx || !ctx.schoolId) return null
  return { supabase: ctx.supabase, schoolId: ctx.schoolId, userId: ctx.userId }
}

export async function savePaymentProvider(form: {
  provider: string
  contractCode: string
  // Left blank on edit to keep the already-saved key. Required first time.
  apiKey: string
  secretKey: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (!SUPPORTED_PROVIDERS.includes(form.provider)) {
    return { error: 'Unsupported payment provider' }
  }
  // Contract code is a Monnify concept; Paystack has no equivalent.
  if (form.provider === 'monnify' && !form.contractCode.trim()) {
    return { error: 'Contract code is required' }
  }

  // Find out what's already stored so blank key fields mean "leave unchanged".
  const { data: existing } = await supabase
    .from('schools')
    .select('provider_api_key, provider_secret_key')
    .eq('id', schoolId)
    .single()

  const apiKey = form.apiKey.trim()
  const secretKey = form.secretKey.trim()

  if (!apiKey && !existing?.provider_api_key) {
    return { error: 'API key is required' }
  }
  if (!secretKey && !existing?.provider_secret_key) {
    return { error: 'Secret key is required' }
  }

  const update: Record<string, string | null> = {
    payment_provider: form.provider,
    // Only Monnify uses it; clear it for Paystack so a stale value can't linger.
    provider_contract_code: form.provider === 'monnify' ? form.contractCode.trim() : null,
  }
  // Only re-encrypt when a new value was actually entered.
  if (apiKey) update.provider_api_key = encryptCredential(apiKey)
  if (secretKey) update.provider_secret_key = encryptCredential(secretKey)

  const { error } = await supabase
    .from('schools')
    .update(update)
    .eq('id', schoolId)

  if (error) return { error: error.message }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment_config.updated',
    targetType: 'school',
    targetId: schoolId,
    summary: `Configured the "${form.provider}" payment provider`,
    metadata: { provider: form.provider },
  })

  revalidatePath('/settings/payments')
  return { success: true }
}

// Confirms the *saved* credentials authenticate against the provider. Run this
// after saving — it never handles the raw secrets, only the stored ones.
export async function testPaymentConnection() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId } = ctx

  let provider
  try {
    provider = await getPaymentProviderForSchool(schoolId, supabase)
  } catch {
    return { error: 'Stored credentials could not be read. Re-enter and save them.' }
  }
  if (!provider) {
    return { error: 'Payments are not fully configured yet. Save your credentials first.' }
  }

  const ok = await provider.verifyCredentials()
  if (!ok) {
    return { error: 'Connection failed — the provider rejected these credentials.' }
  }
  return { success: true }
}
