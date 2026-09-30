// Build a CSV string from a header row + data rows. Values are stringified and
// escaped per RFC 4180 — fields containing a comma, quote, or newline are
// wrapped in double quotes and any embedded quotes are doubled.
//
// A UTF-8 BOM is prepended so Excel opens the file in UTF-8 and renders the
// naira sign and accented names correctly (without it, Excel mangles them).

export type CsvValue = string | number | null | undefined

function escape(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCSV(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escape).join(',')]
  for (const r of rows) lines.push(r.map(escape).join(','))
  const BOM = String.fromCharCode(0xfeff)
  return BOM + lines.join('\r\n')
}
