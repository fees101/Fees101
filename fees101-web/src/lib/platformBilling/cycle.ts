// Free/billed cycle logic for platform billing, mirrored from
// fees101-console/src/lib/accrual.ts so the web-side debit path doesn't import
// console code. Keep in sync: 65 free days, then 300 billed, per 365-day cycle
// anchored to platform_billing.onboarding_at.

const MS_PER_DAY = 86_400_000
const CYCLE_DAYS = 365
const FREE_DAYS = 65

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export type CycleState = {
  billable: boolean
  dayIndex: number
  phaseDay: number
  daysUntilPhaseChange: number
}

// Whether `onDate` falls in a billed (true) or free (false) phase for a school
// onboarded at `onboardingAt`.
export function cycleBillable(onboardingAt: string, onDate: Date): CycleState {
  const dayIndex = Math.floor((utcMidnight(onDate) - utcMidnight(new Date(onboardingAt))) / MS_PER_DAY)
  const phaseDay = ((dayIndex % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS
  const billable = dayIndex >= 0 && phaseDay >= FREE_DAYS
  const daysUntilPhaseChange = phaseDay < FREE_DAYS ? FREE_DAYS - phaseDay : CYCLE_DAYS - phaseDay
  return { billable, dayIndex, phaseDay, daysUntilPhaseChange }
}
