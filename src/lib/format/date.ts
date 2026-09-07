// Month abbreviations hardcoded rather than via toLocaleDateString/Intl —
// Node's bundled ICU and browsers' ICU disagree on the en-GB short form for
// September ("Sept" vs "Sep"), which causes a React hydration mismatch on
// any client component formatting that month. A fixed lookup table always
// agrees between server and client.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  const hours = d.getHours()
  const h12 = hours % 12 === 0 ? 12 : hours % 12
  const ampm = hours < 12 ? 'AM' : 'PM'
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(dateStr)}, ${h12}:${mins} ${ampm}`
}
