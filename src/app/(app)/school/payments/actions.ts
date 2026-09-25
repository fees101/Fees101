'use server'

import { requirePermission } from '@/lib/auth/permissions'
import { revalidatePath } from 'next/cache'
import { encryptCredential } from '@/lib/payments/encryption'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { reconcileSchool } from '@/lib/payments/reconcile'
import { isProviderDownError, providerDownMessage } from '@/lib/payments/providerErrors'
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
  mode: string
  contractCode: string
  // Left blank on edit to keep the already-saved key. Required first time.
  apiKey: string
  secretKey: string
  reason?: string
}) {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  if (!SUPPORTED_PROVIDERS.includes(form.provider)) {
    return { error: 'Unsupported payment provider' }
  }
  if (form.mode !== 'test' && form.mode !== 'live') {
    return { error: 'Mode must be test or live' }
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
    payment_mode: form.mode,
    // Only Monnify uses it; clear it for Paystack so a stale value can't linger.
    provider_contract_code: form.provider === 'monnify' ? form.contractCode.trim() : null,
  }
  // Only re-encrypt when a new value was actually entered.
  if (apiKey) update.provider_api_key = encryptCredential(apiKey)
  if (secretKey) update.provider_secret_key = encryptCredential(secretKey)
  // A rotation is only a rotation when a key actually changed — a plain
  // provider/mode edit must not reset the "rotated ... by ..." marker, and it
  // invalidates the previous "verified" state until re-tested.
  if (apiKey || secretKey) {
    update.keys_rotated_at = new Date().toISOString()
    update.keys_rotated_by = userId
    update.keys_verified_at = null
  }

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
    summary: `Configured the "${form.provider}" payment provider (${form.mode})`,
    metadata: {
      provider: form.provider, mode: form.mode, keysRotated: !!(apiKey || secretKey),
      ...(form.reason?.trim() ? { reason: form.reason.trim() } : {}),
    },
  })

  revalidatePath('/school/payments')
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

  let ok: boolean
  try {
    ok = await provider.verifyCredentials()
  } catch (err) {
    if (isProviderDownError(err)) return { error: providerDownMessage(provider.name) }
    return { error: 'Connection failed — the provider rejected these credentials.' }
  }
  if (!ok) {
    return { error: 'Connection failed — the provider rejected these credentials.' }
  }

  // Record that the saved keys verified cleanly, so the ledger can show
  // "verified today" without re-checking on every page load.
  await supabase
    .from('schools')
    .update({ keys_verified_at: new Date().toISOString() })
    .eq('id', schoolId)

  revalidatePath('/school/payments')
  return { success: true }
}

// Runs a reconciliation sweep on demand — the same backstop the cron runs,
// discovering any transfers the webhooks missed. reconcileSchool stamps
// last_reconciled_at itself, so both paths keep the "last run" marker honest.
export async function runReconciliationNow() {
  const ctx = await getContext()
  if (!ctx) return { error: 'Not authenticated' }
  const { supabase, schoolId, userId } = ctx

  let result
  try {
    result = await reconcileSchool(schoolId, supabase)
  } catch (err: any) {
    if (isProviderDownError(err)) return { error: providerDownMessage(null) }
    return { error: err?.message || 'Reconciliation failed to run.' }
  }
  if (result.errors.length > 0 && result.applied === 0) {
    return { error: result.errors[0] }
  }

  await logAuditEvent(supabase, {
    schoolId,
    actorId: userId,
    action: 'payment_config.updated',
    targetType: 'school',
    targetId: schoolId,
    summary: `Ran reconciliation manually — applied ${result.applied} payment${result.applied === 1 ? '' : 's'}`,
    metadata: { applied: result.applied, studentsChecked: result.studentsChecked },
  })

  revalidatePath('/school/payments')
  return { success: true, applied: result.applied, studentsChecked: result.studentsChecked }
}
