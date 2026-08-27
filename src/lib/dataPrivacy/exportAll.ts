import { createClient } from '@/lib/supabase/server'
import { toCSV, type CsvValue } from '@/lib/reports/csv'
import { buildZip, type ZipEntry } from '@/lib/reports/zip'

// ---------------------------------------------------------------------------
// "Download all my data" — a full, portable export of everything a school owns,
// as one .zip of per-table CSVs. This is the data-portability half of Data &
// privacy ("it's their data, they can have it"). Owner-only; the caller (the
// export route) enforces that before calling in.
//
// Only business data the school owns is exported. Internal plumbing tables
// (provider webhook payloads, processed-transaction ledgers) are deliberately
// excluded — they're operational records, not the school's own data, and can
// contain raw third-party payloads.
// ---------------------------------------------------------------------------

// Each business table, in a sensible reading order. All are school-scoped by a
// direct school_id column.
const EXPORT_TABLES: { table: string; file: string }[] = [
  { table: 'students', file: 'students' },
  { table: 'families', file: 'parents-guardians' },
  { table: 'classes', file: 'classes' },
  { table: 'sections', file: 'sections' },
  { table: 'sessions', file: 'academic-sessions' },
  { table: 'billing_cycles', file: 'billing-terms' },
  { table: 'fee_items', file: 'fee-items' },
  { table: 'student_fee_adjustments', file: 'fee-adjustments' },
  { table: 'invoices', file: 'invoices' },
  { table: 'payments', file: 'payments' },
  { table: 'discounts', file: 'discounts' },
  { table: 'message_logs', file: 'messages-sent' },
  { table: 'users', file: 'staff-accounts' },
  { table: 'roles', file: 'roles' },
]

// Columns we never export even if present — access tokens / secrets that could
// live on a row. Defensive: most of these won't exist on these tables, but a
// data export must never leak a credential.
const REDACT_COLUMNS = new Set([
  'password',
  'password_hash',
  'access_token',
  'refresh_token',
  'api_key',
  'secret',
])

function rowsToCsv(rows: Record<string, any>[]): string {
  if (!rows.length) return toCSV(['(no records)'], [])
  // Union of keys across all rows, preserving first-seen order, minus redactions.
  const headers: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k) && !REDACT_COLUMNS.has(k)) {
        seen.add(k)
        headers.push(k)
      }
    }
  }
  const body: CsvValue[][] = rows.map(row =>
    headers.map(h => {
      const v = row[h]
      if (v === null || v === undefined) return ''
      if (typeof v === 'object') return JSON.stringify(v)
      return v as CsvValue
    }),
  )
  return toCSV(headers, body)
}

export interface FullExport {
  filename: string
  bytes: Uint8Array
}

export async function buildFullExport(schoolId: string, today: string): Promise<FullExport> {
  const supabase = await createClient()
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = []

  // Fetch every table in parallel, each scoped to this school.
  const results = await Promise.all(
    EXPORT_TABLES.map(async ({ table, file }) => {
      const { data, error } = await supabase.from(table).select('*').eq('school_id', schoolId)
      return { file, rows: error ? [] : (data ?? []) }
    }),
  )

  for (const { file, rows } of results) {
    const csv = rowsToCsv(rows as Record<string, any>[])
    entries.push({ name: `${file}.csv`, data: encoder.encode(csv) })
  }

  // A short README so a school opening the zip understands what they have.
  const readme =
    `Fees101 — full data export\n` +
    `Generated: ${today}\n\n` +
    `This archive contains all data held for your school, one CSV per category.\n` +
    `Files open in Excel, Google Sheets or any spreadsheet tool.\n\n` +
    EXPORT_TABLES.map(t => `- ${t.file}.csv`).join('\n') + '\n'
  entries.push({ name: 'README.txt', data: encoder.encode(readme) })

  return {
    filename: `fees101-data-export-${today}.zip`,
    bytes: buildZip(entries),
  }
}
