'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/permissions'

interface ParsedRow {
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

const REQUIRED_FIELDS = [
  'first_name', 'last_name', 'admission_number', 'class_name', 'parent_name', 'parent_phone'
]

const EXPECTED_HEADERS = [
  'first_name', 'last_name', 'admission_number', 'class_name', 'admission_date',
  'parent_name', 'parent_phone', 'parent_email',
  'secondary_parent_name', 'secondary_parent_phone', 'secondary_parent_email', 'notes'
]

function parseCSV(text: string): { headers: string[], rows: string[][] } {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }

  // Simple CSV parser — handles quoted strings with commas
  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase())
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

function isValidPhone(phone: string): boolean {
  // Nigerian format: +234 followed by 10 digits, or 0 followed by 10 digits
  const cleaned = phone.replace(/[\s\-()]/g, '')
  return /^(\+234|234|0)?[789][01]\d{8}$/.test(cleaned)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(date).getTime())
}

export async function parseAndValidateCSV(csvText: string) {
  // Gated on manage-students (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-students')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  const { supabase, schoolId } = ctx

  // Get all classes for matching
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('is_active', true)

  // Get existing admission numbers
  const { data: existingStudents } = await supabase
    .from('students')
    .select('admission_number')
    .eq('school_id', schoolId)

  const existingAdmissionNumbers = new Set(
    existingStudents?.map(s => s.admission_number) || []
  )

  const { headers, rows } = parseCSV(csvText)

  // Validate headers
  const missingRequired = REQUIRED_FIELDS.filter(f => !headers.includes(f))
  if (missingRequired.length > 0) {
    return { 
      error: `CSV is missing required columns: ${missingRequired.join(', ')}` 
    }
  }

  // Build column index map
  const colIndex: Record<string, number> = {}
  EXPECTED_HEADERS.forEach(h => {
    colIndex[h] = headers.indexOf(h)
  })

  function getValue(row: string[], col: string): string {
    const idx = colIndex[col]
    if (idx === -1) return ''
    return (row[idx] || '').trim()
  }

  // Track admission numbers within this CSV to catch duplicates IN the file
  const seenAdmissionNumbers = new Set<string>()

  // Parse and validate rows
  const parsedRows: ParsedRow[] = rows.map((row, index) => {
    const parsed: ParsedRow = {
      rowNumber: index + 2, // Row 1 is headers, so data starts at row 2
      firstName: getValue(row, 'first_name'),
      lastName: getValue(row, 'last_name'),
      admissionNumber: getValue(row, 'admission_number'),
      className: getValue(row, 'class_name'),
      admissionDate: getValue(row, 'admission_date'),
      parentName: getValue(row, 'parent_name'),
      parentPhone: getValue(row, 'parent_phone'),
      parentEmail: getValue(row, 'parent_email'),
      secondaryParentName: getValue(row, 'secondary_parent_name'),
      secondaryParentPhone: getValue(row, 'secondary_parent_phone'),
      secondaryParentEmail: getValue(row, 'secondary_parent_email'),
      notes: getValue(row, 'notes'),
      errors: [],
    }

    // Required field validation
    if (!parsed.firstName) parsed.errors.push('First name is required')
    if (!parsed.lastName) parsed.errors.push('Last name is required')
    if (!parsed.admissionNumber) parsed.errors.push('Admission number is required')
    if (!parsed.className) parsed.errors.push('Class name is required')
    if (!parsed.parentName) parsed.errors.push('Parent name is required')
    if (!parsed.parentPhone) parsed.errors.push('Parent phone is required')

    // Admission number uniqueness
    if (parsed.admissionNumber) {
      if (existingAdmissionNumbers.has(parsed.admissionNumber)) {
        parsed.errors.push(`Admission number ${parsed.admissionNumber} already exists`)
      }
      if (seenAdmissionNumbers.has(parsed.admissionNumber)) {
        parsed.errors.push(`Duplicate admission number ${parsed.admissionNumber} in this file`)
      }
      seenAdmissionNumbers.add(parsed.admissionNumber)
    }

    // Class matching (case-insensitive)
    if (parsed.className) {
      const matched = classes?.find(c => c.name.toLowerCase() === parsed.className.toLowerCase())
      if (matched) {
        parsed.classId = matched.id
        parsed.className = matched.name // Use the canonical class name
      } else {
        parsed.errors.push(`Class "${parsed.className}" doesn't exist at this school`)
      }
    }

    // Phone validation
    if (parsed.parentPhone && !isValidPhone(parsed.parentPhone)) {
      parsed.errors.push('Parent phone is not a valid Nigerian number')
    }
    if (parsed.secondaryParentPhone && !isValidPhone(parsed.secondaryParentPhone)) {
      parsed.errors.push('Secondary parent phone is not a valid Nigerian number')
    }

    // Email validation
    if (parsed.parentEmail && !isValidEmail(parsed.parentEmail)) {
      parsed.errors.push('Parent email is not valid')
    }
    if (parsed.secondaryParentEmail && !isValidEmail(parsed.secondaryParentEmail)) {
      parsed.errors.push('Secondary parent email is not valid')
    }

    // Admission date validation (optional, default to today if missing)
    if (parsed.admissionDate && !isValidDate(parsed.admissionDate)) {
      parsed.errors.push('Admission date must be YYYY-MM-DD format')
    }
    if (!parsed.admissionDate) {
      parsed.admissionDate = new Date().toISOString().split('T')[0]
    }

    return parsed
  })

  return {
    success: true,
    rows: parsedRows,
    summary: {
      total: parsedRows.length,
      valid: parsedRows.filter(r => r.errors.length === 0).length,
      invalid: parsedRows.filter(r => r.errors.length > 0).length,
    }
  }
}

export async function importStudents(rows: ParsedRow[]) {
  // Gated on manage-students (owner/super_admin/is_admin bypass).
  const ctx = await requirePermission('manage-students')
  if (!ctx || !ctx.schoolId) return { error: 'Not authorized' }
  const { supabase, schoolId } = ctx

  const { data: section } = await supabase
    .from('sections')
    .select('id')
    .eq('school_id', schoolId)
    .limit(1)
    .single()

  if (!section) return { error: 'No section found' }

  // Only import valid rows
  const validRows = rows.filter(r => r.errors.length === 0)
  if (validRows.length === 0) return { error: 'No valid rows to import' }

  // Note: virtual accounts are NOT created inline here — a large import (300+)
  // would exceed request/serverless time limits. Import is DB-only; accounts are
  // provisioned afterwards via the batched "Create accounts" flow on Settings →
  // Payments (see createDVAsForAllStudents).
  let imported = 0
  let failed = 0
  const failedRows: { row: number, reason: string }[] = []

  // Process each valid row
  for (const row of validRows) {
    try {
      // Check if family with same primary parent phone exists
      const { data: existingFamily } = await supabase
        .from('families')
        .select('id')
        .eq('school_id', schoolId)
        .eq('primary_parent_phone', row.parentPhone)
        .maybeSingle()

      let familyId: string

      if (existingFamily) {
        familyId = existingFamily.id
      } else {
        const { data: newFamily, error: familyError } = await supabase
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

        if (familyError || !newFamily) {
          failed++
          failedRows.push({ row: row.rowNumber, reason: familyError?.message || 'Family creation failed' })
          continue
        }
        familyId = newFamily.id
      }

      // Insert the student
      const { error: studentError } = await supabase
        .from('students')
        .insert({
          school_id: schoolId,
          section_id: section.id,
          class_id: row.classId!,
          family_id: familyId,
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

// Build class breakdown — only count successfully imported students
  const classCounts: Record<string, number> = {}
  const failedRowNumbers = new Set(failedRows.map(f => f.row))
  
  for (const row of validRows) {
    if (!failedRowNumbers.has(row.rowNumber)) {
      classCounts[row.className] = (classCounts[row.className] || 0) + 1
    }
  }

  // Get school name for display
  const { data: school } = await supabase
    .from('schools')
    .select('name')
    .eq('id', schoolId)
    .single()

  revalidatePath('/students')

  return {
    success: true,
    imported,
    failed,
    failedRows,
    schoolName: school?.name || 'your school',
    breakdown: classCounts,
  }
}