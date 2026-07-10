// Shared DVA provisioning used by the single-student, bulk, and auto-create
// (student add / CSV import) paths. Server-only — never import from a client
// component.

import { getPaymentProviderForSchool } from './getProvider'
import { PaymentProvider } from './types'

// Core: create the DVA at the provider (with a retry + lost-response recovery)
// and persist it on the student row. Assumes the student has no DVA yet and the
// provider is already resolved. Throws a user-ready message on failure.
export async function provisionStudentDVA(
  supabase: any,
  schoolId: string,
  provider: PaymentProvider,
  studentId: string,
  fullName: string
): Promise<{ accountNumber: string; bankName: string }> {
  const params = {
    reference: studentId, // accountReference is always the student's own id — stable and unique
    accountName: fullName,
    customerEmail: `student-${studentId}@fees101.internal`,
    customerName: fullName,
  }

  let dva
  try {
    dva = await provider.createDVA(params)
  } catch (firstErr: any) {
    // Monnify's error messages (especially the generic "99") aren't
    // reliable enough to fail on the first attempt — retry once.
    await new Promise(r => setTimeout(r, 1200))
    try {
      dva = await provider.createDVA(params)
    } catch (secondErr: any) {
      // Last resort: the first attempt may have actually succeeded on
      // Monnify's side and only the response was lost (or this is the
      // losing half of a double-click race) — check before giving up.
      const existing = await provider.getDVA(studentId).catch(() => null)
      if (existing) {
        dva = existing
      } else {
        throw new Error(`Could not create payment account: ${secondErr?.message || firstErr?.message || 'unknown error'}`)
      }
    }
  }

  const { error: updateError } = await supabase
    .from('students')
    .update({
      provider_dva_reference: studentId,
      provider_dva_bank_code: dva.bankCode,
      provider_dva_account_number: dva.accountNumber,
      provider_dva_bank_name: dva.bankName,
      provider_dva_created_at: new Date().toISOString(),
    })
    .eq('id', studentId)
    .eq('school_id', schoolId)

  if (updateError) throw new Error(`Payment account created but failed to save: ${updateError.message}`)

  return { accountNumber: dva.accountNumber, bankName: dva.bankName }
}

// Best-effort auto-create for the student-add path. Resolves the provider
// itself and NEVER throws — provisioning must not block student creation. When
// payments aren't configured it silently skips. Returns whether an account was
// created. Any failure is left for the Settings → Payments bulk button to fix.
export async function tryAutoCreateStudentDVA(
  supabase: any,
  schoolId: string,
  studentId: string,
  fullName: string
): Promise<boolean> {
  try {
    const provider = await getPaymentProviderForSchool(schoolId, supabase)
    if (!provider) return false
    await provisionStudentDVA(supabase, schoolId, provider, studentId, fullName)
    return true
  } catch {
    return false
  }
}
