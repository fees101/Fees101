// Shared DVA provisioning used by the single-student, bulk, and auto-create
// (student add / CSV import) paths. Server-only — never import from a client
// component.

import { getPaymentProviderForSchool } from './getProvider'
import { PaymentProvider } from './types'
import { createJob, findRunningJob } from '@/lib/jobs/backgroundJobs'

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
    // Synthetic, unique-per-student, never actually emailed to. Must use a
    // real TLD: Paystack validates the address format and rejects made-up
    // TLDs like ".internal" (Monnify doesn't care, but this works for both).
    // students.fees101.com is a domain we own with no mailbox behind it.
    customerEmail: `student-${studentId}@students.fees101.com`,
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
      // The provider's own stable per-student key: Monnify's accountReference
      // (which we set to studentId) or Paystack's customer_code. Present on
      // every webhook, so it's how we match a payment back to this student.
      provider_dva_reference: dva.reference,
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

// Starts (or finds the already-running) bulk_dva job for a school. Shared by
// the Settings page's button (src/app/(app)/students/[id]/actions.ts) and
// CSV import's phase-2 chain (advanceCsvImport in advanceJob.ts) — the latter
// runs server-side on job completion so provisioning still happens even if
// the tab was closed partway through the import, instead of depending on a
// client-side completion callback.
export async function ensureBulkDVAJob(
  supabase: any,
  schoolId: string,
  createdBy: string
): Promise<{ error: string } | { jobId: string | null; total: number; processed: number }> {
  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) return { error: 'This school has no payment provider configured yet.' }

  const { count: total } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)

  if (!total) return { jobId: null, total: 0, processed: 0 }

  const existingJob = await findRunningJob(schoolId, 'bulk_dva')
  if (existingJob) {
    return { jobId: existingJob.id, total: existingJob.total, processed: existingJob.processed }
  }

  const job = await createJob({ schoolId, jobType: 'bulk_dva', payload: {}, total, createdBy })
  return { jobId: job.id, total, processed: 0 }
}

export interface BulkDVAChunkResult {
  created: number
  failed: number
  failures: { label: string; error: string }[]
  remaining: number
}

// One batch of the bulk-provision loop, driven by startBulkDVAJob
// (src/app/(app)/students/[id]/actions.ts) via the background-job worker
// (src/lib/jobs/advanceJob.ts) and the daily sweep, the same way CSV import's
// chunk processor was split out.
// No cursor needed — each call just re-queries "active students still
// missing a DVA", since a completed student naturally falls out of the next
// query. Caller is expected to have already permission-checked.
export async function processBulkDVAChunk(
  supabase: any,
  schoolId: string,
  chunkSize: number
): Promise<BulkDVAChunkResult | { error: string }> {
  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) return { error: 'This school has no payment provider configured yet.' }

  const { data: students, error } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)
    .limit(chunkSize)

  if (error) return { error: error.message }

  let created = 0
  const failures: { label: string; error: string }[] = []
  for (const s of students || []) {
    const fullName = `${s.first_name} ${s.last_name}`.trim()
    try {
      await provisionStudentDVA(supabase, schoolId, provider, s.id, fullName)
      created++
    } catch (err: any) {
      failures.push({ label: fullName || s.id, error: err?.message || 'unknown error' })
    }
  }

  const { count: remaining } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('provider_dva_reference', null)

  return { created, failed: failures.length, failures, remaining: remaining ?? 0 }
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
