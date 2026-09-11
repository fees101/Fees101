export interface ParsedRow {
  rowNumber: number
  firstName: string
  lastName: string
  admissionNumber: string
  className: string
  admissionDate: string
  parentName: string
  parentPhone: string
  parentEmail: string
  secondaryParentName: string
  secondaryParentPhone: string
  secondaryParentEmail: string
  notes: string
  errors: string[]
  classId?: string
}

export interface ImportChunkResult {
  imported: number
  failed: number
  failedRows: { row: number; reason: string }[]
}

// Chunkable CSV-row import, extracted out of students/import/actions.ts so
// the background-job worker route and the daily sweep can both call the same
// per-row logic with a service-role client, the same way invoice generation's
// chunk processor was split out in src/lib/invoicing/invoiceGeneration.ts.
// Callers are expected to have already permission-checked and filtered to
// only rows with no validation errors.
export async function processCsvImportChunk(
  supabase: any,
  schoolId: string,
  rows: ParsedRow[]
): Promise<ImportChunkResult> {
  const { data: section } = await supabase
    .from('sections')
    .select('id')
    .eq('school_id', schoolId)
    .limit(1)
    .single()

  if (!section) {
    return { imported: 0, failed: rows.length, failedRows: rows.map(r => ({ row: r.rowNumber, reason: 'No section found' })) }
  }

  let imported = 0
  let failed = 0
  const failedRows: { row: number; reason: string }[] = []

  // Resolve families for this chunk in bulk instead of one lookup+insert pair
  // per row — rows sharing a phone within the same chunk also share one
  // family, same as the old per-row de-dupe did.
  const uniquePhones = Array.from(new Set(rows.map(r => r.parentPhone)))
  const familyIdByPhone = new Map<string, string>()

  const { data: existingFamilies } = await supabase
    .from('families')
    .select('id, primary_parent_phone')
    .eq('school_id', schoolId)
    .in('primary_parent_phone', uniquePhones)

  for (const f of existingFamilies || []) familyIdByPhone.set(f.primary_parent_phone, f.id)

  const phonesToCreate = uniquePhones.filter(p => !familyIdByPhone.has(p))
  if (phonesToCreate.length > 0) {
    const firstRowByPhone = new Map<string, ParsedRow>()
    for (const row of rows) {
      if (!firstRowByPhone.has(row.parentPhone)) firstRowByPhone.set(row.parentPhone, row)
    }

    const { data: newFamilies, error: familyError } = await supabase
      .from('families')
      .insert(
        phonesToCreate.map(phone => {
          const row = firstRowByPhone.get(phone)!
          return {
            school_id: schoolId,
            primary_parent_name: row.parentName,
            primary_parent_phone: row.parentPhone,
            primary_parent_email: row.parentEmail || null,
            secondary_parent_name: row.secondaryParentName || null,
            secondary_parent_phone: row.secondaryParentPhone || null,
            secondary_parent_email: row.secondaryParentEmail || null,
            notes: row.notes || null,
          }
        })
      )
      .select('id, primary_parent_phone')

    if (familyError) {
      // Bulk family creation failed (rare) — fall back to per-row for just
      // the rows whose family we couldn't resolve, so one bad row doesn't
      // sink the whole chunk.
      for (const phone of phonesToCreate) {
        const row = firstRowByPhone.get(phone)!
        const { data: retryFamily, error: retryError } = await supabase
          .from('families')
          .insert({
            school_id: schoolId,
            primary_parent_name: row.parentName,
            primary_parent_phone: row.parentPhone,
            primary_parent_email: row.parentEmail || null,
            secondary_parent_name: row.secondaryParentName || null,
            secondary_parent_phone: row.secondaryParentPhone || null,
            secondary_parent_email: row.secondaryParentEmail || null,
            notes: row.notes || null,
          })
          .select('id')
          .single()
        if (retryError || !retryFamily) {
          failedRows.push({ row: row.rowNumber, reason: retryError?.message || 'Family creation failed' })
        } else {
          familyIdByPhone.set(phone, retryFamily.id)
        }
      }
    } else {
      for (const f of newFamilies || []) familyIdByPhone.set(f.primary_parent_phone, f.id)
    }
  }

  const failedPhones = new Set(phonesToCreate.filter(p => !familyIdByPhone.has(p)))
  const rowsWithFamily = rows.filter(r => !failedPhones.has(r.parentPhone))
  for (const row of rows) {
    if (failedPhones.has(row.parentPhone) && !failedRows.some(f => f.row === row.rowNumber)) {
      failed++
      failedRows.push({ row: row.rowNumber, reason: 'Family creation failed' })
    }
  }

  // Bulk-insert students; fall back to per-row only if the batch insert
  // itself fails (e.g. a stray constraint violation), so we still get
  // per-row error reporting without paying for it on the common path.
  const { error: bulkStudentError } = await supabase
    .from('students')
    .insert(
      rowsWithFamily.map(row => ({
        school_id: schoolId,
        section_id: section.id,
        class_id: row.classId!,
        family_id: familyIdByPhone.get(row.parentPhone)!,
        first_name: row.firstName,
        last_name: row.lastName,
        admission_number: row.admissionNumber,
        admission_date: row.admissionDate,
        status: 'active',
      }))
    )

  if (bulkStudentError) {
    for (const row of rowsWithFamily) {
      try {
        const { error: studentError } = await supabase
          .from('students')
          .insert({
            school_id: schoolId,
            section_id: section.id,
            class_id: row.classId!,
            family_id: familyIdByPhone.get(row.parentPhone)!,
            first_name: row.firstName,
            last_name: row.lastName,
            admission_number: row.admissionNumber,
            admission_date: row.admissionDate,
            status: 'active',
          })
        if (studentError) {
          failed++
          failedRows.push({ row: row.rowNumber, reason: studentError.message })
        } else {
          imported++
        }
      } catch (err) {
        failed++
        failedRows.push({ row: row.rowNumber, reason: err instanceof Error ? err.message : 'Unknown error' })
      }
    }
  } else {
    imported += rowsWithFamily.length
  }

  return { imported, failed, failedRows }
}
