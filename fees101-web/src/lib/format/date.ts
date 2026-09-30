// Month abbreviations hardcoded rather than via toLocaleDateString/Intl —
// Node's bundled ICU and browsers' ICU disagree on the en-GB short form for
// September ("Sept" vs "Sep"), which causes a React hydration mismatch on
// any client component formatting that month. A fixed lookup table always
// agrees between server and client.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The school operates on Lagos time; pin every date/time read to it rather
// than each runtime's local TZ (see src/components/activity/ActivityFeed.tsx
// for the same convention). Without this, `d.getHours()`/`d.getDate()` read
// the Node process's TZ on the server and the browser's TZ on the client —
// different environments, different wall-clock values, and a React hydration
// mismatch on every row that renders one of these.
const TZ = 'Africa/Lagos'

function lagosParts(dateStr: string) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month') - 1, day: get('day'), hour: get('hour') % 24, minute: get('minute') }
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const p = lagosParts(dateStr)
  if (!p) return '—'
  return `${p.day} ${MONTHS_SHORT[p.month]} ${p.year}`
}

// For a plain "YYYY-MM-DD" (no time component), the calendar day is already
// unambiguous — no TZ conversion needed or possible. Feeding it through `new
// Date("...T00:00:00")` instead parses as local time in whatever TZ the
// runtime happens to be in (server vs. browser), which is what caused the
// day-range hydration mismatch on Today → Record.
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [, m, d] = dateStr.split('-').map(Number)
    return `${d} ${MONTHS_SHORT[m - 1]}`
  }
  const p = lagosParts(dateStr)
  if (!p) return '—'
  return `${p.day} ${MONTHS_SHORT[p.month]}`
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const p = lagosParts(dateStr)
  if (!p) return '—'
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  const ampm = p.hour < 12 ? 'AM' : 'PM'
  const mins = String(p.minute).padStart(2, '0')
  return `${formatDate(dateStr)}, ${h12}:${mins} ${ampm}`
}
