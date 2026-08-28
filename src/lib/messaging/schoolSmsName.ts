// Full school names (e.g. "Creative Kids Elementary and High School") easily
// push SMS text past the 160-char GSM segment limit, which silently doubles
// the SMS bill per message. Schools can set a short SMS name (e.g. "CKEHS")
// in Settings > School profile; if they don't, we auto-abbreviate the full
// name instead — the "Hello {{name}}" / "Powered by Fees101" template wording
// is fixed and must never be shortened to make room.
const STOP_WORDS = new Set(['and', 'of', 'the', 'for', '&'])

export function abbreviateSchoolName(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase())
    .join('')
  return initials.length >= 2 ? initials : name
}

export function getSchoolSmsName(school: { name?: string | null; settings?: any } | null): string {
  const custom = school?.settings?.smsShortName?.trim()
  if (custom) return custom
  const name = school?.name || 'Your school'
  return name.length > 20 ? abbreviateSchoolName(name) : name
}
