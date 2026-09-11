import { revalidatePath } from 'next/cache'
import {
  updateJobProgress,
  completeJob,
  JOB_TIME_BUDGET_MS,
  type BackgroundJob,
} from '@/lib/jobs/backgroundJobs'
import {
  processInvoiceGenerationChunk,
  processInvoiceRegenerationChunk,
} from '@/lib/invoicing/invoiceGeneration'
import { processCsvImportChunk, type ParsedRow } from '@/lib/students/csvImport'
import { processBulkDVAChunk, ensureBulkDVAJob } from '@/lib/payments/provisionDVA'
import { getPaymentProviderForSchool } from '@/lib/payments/getProvider'
import { logAuditEvent } from '@/lib/audit/logAudit'

// Advances one background_jobs row by as many chunks as fit in
// JOB_TIME_BUDGET_MS, then returns — still "running" if there's more left.
// Shared by the authenticated worker route (src/app/api/jobs/process) and the
// daily cron safety net (src/app/api/admin/job-sweep), so both drive the same
// per-item logic regardless of which Supabase client (user session vs.
// service role) called it.

const CHUNK_SIZE = 25

export async function advanceJob(supabase: any, job: BackgroundJob): Promise<void> {
  const started = Date.now()
  if (job.job_type === 'invoice_generation') {
    await advanceInvoiceGeneration(supabase, job, started)
  } else if (job.job_type === 'invoice_regeneration') {
    await advanceInvoiceRegeneration(supabase, job, started)
  } else if (job.job_type === 'csv_import') {
    await advanceCsvImport(supabase, job, started)
  } else if (job.job_type === 'bulk_dva') {
    await advanceBulkDVA(supabase, job, started)
  } else {
    throw new Error(`Unsupported job_type: ${job.job_type}`)
  }
}

async function advanceInvoiceGeneration(supabase: any, job: BackgroundJob, started: number) {
  const schoolId = job.school_id
  const cycleId = job.payload.cycleId as string
  const yy = job.payload.yy as string
  const studentNames = (job.payload.studentNames as Record<string, string>) || {}
  let studentIds = (job.cursor.studentIds as string[]) || []
  let nextSeq = (job.cursor.nextSeq as number) ?? 1
  let processed = job.processed
  let failed = job.failed
  const failures = [...job.failures]

  while (studentIds.length > 0 && Date.now() - started < JOB_TIME_BUDGET_MS) {
    const slice = studentIds.slice(0, CHUNK_SIZE)
    const rest = studentIds.slice(CHUNK_SIZE)

    const result = await processInvoiceGenerationChunk(supabase, schoolId, cycleId, slice, yy, nextSeq, studentNames)
    processed += result.generated
    failed += result.errors.length
    failures.push(...result.errors)
    nextSeq = result.nextSeq
    studentIds = rest

    await updateJobProgress(job.id, { cursor: { studentIds, nextSeq }, processed, failed, failures })
  }

  if (studentIds.length === 0) {
    await supabase
      .from('billing_cycles')
      .update({ invoices_generated_at: new Date().toISOString() })
      .eq('id', cycleId)

    const { data: cycle } = await supabase.from('billing_cycles').select('name').eq('id', cycleId).single()
    await logAuditEvent(supabase, {
      schoolId,
      actorId: job.created_by,
      action: 'invoice.generated_bulk',
      targetType: 'billing_cycle',
      targetId: cycleId,
      summary: `Generated ${processed} invoice(s) for term ${cycle?.name ?? cycleId}${failed > 0 ? ` (${failed} failed)` : ''}`,
      metadata: { count: processed, failures: failed, alreadyHad: job.payload.alreadyHad, errors: failures },
    })

    revalidatePath(`/fees/cycles/${cycleId}`)
    revalidatePath('/fees/cycles')
    revalidatePath('/fees')

    await completeJob(job.id)
  }
}

async function advanceInvoiceRegeneration(supabase: any, job: BackgroundJob, started: number) {
  const schoolId = job.school_id
  const cycleId = job.payload.cycleId as string
  let invoiceIds = (job.cursor.invoiceIds as string[]) || []
  let processed = job.processed
  let failed = job.failed
  let alreadyUpToDate = (job.cursor.alreadyUpToDate as number) || 0
  const failures = [...job.failures]

  while (invoiceIds.length > 0 && Date.now() - started < JOB_TIME_BUDGET_MS) {
    const slice = invoiceIds.slice(0, CHUNK_SIZE)
    const rest = invoiceIds.slice(CHUNK_SIZE)

    const result = await processInvoiceRegenerationChunk(supabase, schoolId, cycleId, slice)
    processed += result.regenerated
    alreadyUpToDate += result.alreadyUpToDate
    failed += result.errors.length
    failures.push(...result.errors)
    invoiceIds = rest

    await updateJobProgress(job.id, { cursor: { invoiceIds, alreadyUpToDate }, processed, failed, failures })
  }

  if (invoiceIds.length === 0) {
    const { data: cycle } = await supabase.from('billing_cycles').select('name').eq('id', cycleId).single()
    await logAuditEvent(supabase, {
      schoolId,
      actorId: job.created_by,
      action: 'invoice.regenerated_bulk',
      targetType: 'billing_cycle',
      targetId: cycleId,
      summary: `Regenerated ${processed} stale invoice(s) for term ${cycle?.name ?? cycleId}${failed > 0 ? ` (${failed} failed)` : ''}`,
      metadata: { count: processed, failures: failed, alreadyUpToDate, errors: failures },
    })

    revalidatePath(`/fees/cycles/${cycleId}`)
    revalidatePath('/fees/cycles')
    revalidatePath('/fees')

    await completeJob(job.id)
  }
}

async function advanceCsvImport(supabase: any, job: BackgroundJob, started: number) {
  const schoolId = job.school_id
  let rows = (job.cursor.rows as ParsedRow[]) || []
  let processed = job.processed
  let failed = job.failed
  const failures = [...job.failures]

  while (rows.length > 0 && Date.now() - started < JOB_TIME_BUDGET_MS) {
    const slice = rows.slice(0, CHUNK_SIZE)
    const rest = rows.slice(CHUNK_SIZE)

    const result = await processCsvImportChunk(supabase, schoolId, slice)
    processed += result.imported
    failed += result.failed
    failures.push(...result.failedRows.map(f => ({ label: `Row ${f.row}`, error: f.reason })))
    rows = rest

    await updateJobProgress(job.id, { cursor: { rows }, processed, failed, failures })
  }

  if (rows.length === 0) {
    await logAuditEvent(supabase, {
      schoolId,
      actorId: job.created_by,
      action: 'student.imported',
      targetType: 'student',
      summary: `Imported ${processed} students${failed > 0 ? ` (${failed} failed)` : ''}`,
      metadata: { count: processed, failures: failed, errors: failures },
    })

    revalidatePath('/students')

    await completeJob(job.id)

    // Chain phase 2 (payment account provisioning) here, server-side, rather
    // than relying on the client's completion callback — this way it still
    // runs even if the tab was closed partway through the import. Best
    // effort: skip silently if payments aren't configured or there's
    // nothing to provision.
    if (job.created_by) {
      await ensureBulkDVAJob(supabase, schoolId, job.created_by).catch(() => null)
    }
  }
}

async function advanceBulkDVA(supabase: any, job: BackgroundJob, started: number) {
  const schoolId = job.school_id
  let studentIds = (job.cursor.studentIds as string[]) || []
  let processed = job.processed
  let failed = job.failed
  const failures = [...job.failures]

  // Resolve the provider once for the whole run rather than per chunk. If it's
  // gone (removed after the job was queued) there's nothing to provision —
  // throw so the worker/sweep marks the job failed instead of looping.
  const provider = await getPaymentProviderForSchool(schoolId, supabase)
  if (!provider) throw new Error('This school has no payment provider configured yet.')

  // Consume the cursor a chunk at a time, removing each slice whether or not
  // its students succeeded — so the checklist always empties and the job ends.
  while (studentIds.length > 0 && Date.now() - started < JOB_TIME_BUDGET_MS) {
    const slice = studentIds.slice(0, CHUNK_SIZE)
    const rest = studentIds.slice(CHUNK_SIZE)

    const result = await processBulkDVAChunk(supabase, schoolId, provider, slice)
    processed += result.created
    failed += result.failed
    failures.push(...result.failures)
    studentIds = rest

    await updateJobProgress(job.id, { cursor: { studentIds }, processed, failed, failures })
  }

  if (studentIds.length === 0) {
    await logAuditEvent(supabase, {
      schoolId,
      actorId: job.created_by,
      action: 'student.dva_bulk_created',
      targetType: 'student',
      summary: `Created ${processed} payment accounts${failed > 0 ? ` (${failed} failed)` : ''}`,
      metadata: { count: processed, failures: failed },
    })

    revalidatePath('/settings/payments')
    revalidatePath('/students')

    await completeJob(job.id)
  }
}
