// Throwaway: self-test the recurring direct-debit cron (slice 2) end to end
// against the test school, then restore state. Delete after testing.
//
// Steps: back-date onboarding_at so September is billable, seed a few September
// daily-usage rows, trigger the charge-mandates cron, print the resulting charge
// / period / billing state, then restore onboarding_at.
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]
}
const base = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const cronSecret = env.PLATFORM_BILLING_CRON_SECRET
const schoolId = process.argv[2] || 'd80be88f-c95b-4205-9698-75f806343d84'
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function rest(path, init) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: h, ...init })
  const text = await r.text()
  if (!r.ok) { console.error('REST', path, r.status, text); process.exit(1) }
  return text ? JSON.parse(text) : null
}

// 0. Save original onboarding_at
const [before] = await rest(`platform_billing?school_id=eq.${schoolId}&select=onboarding_at,mandate_status,billing_status`)
console.log('original:', before)

// 1. Back-date onboarding so Sept 2026 is a billed month (>65 days in)
await rest(`platform_billing?school_id=eq.${schoolId}`, {
  method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
  body: JSON.stringify({ onboarding_at: '2026-07-01T00:00:00Z' }),
})

// 2. Seed September daily usage (3 days x NGN50 = NGN150 due)
const usage = ['2026-09-28', '2026-09-29', '2026-09-30'].map(d => ({
  school_id: schoolId, usage_date: d, active_student_count: 3, billable: true, accrued_amount: 50,
}))
await rest(`platform_daily_usage?on_conflict=school_id,usage_date`, {
  method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(usage),
})
console.log('seeded 3 September usage days (NGN150 due)')

// 3. Trigger the cron
const cronRes = await fetch(
  `http://localhost:3000/api/cron/charge-mandates?secret=${encodeURIComponent(cronSecret)}`,
  { headers: {} },
)
console.log('\ncron HTTP', cronRes.status)
console.log(JSON.stringify(await cronRes.json(), null, 2))

// 4. Show resulting state
const charges = await rest(`platform_billing_charges?school_id=eq.${schoolId}&charged_by=eq.monthly_fee&select=amount,status,method,paystack_reference,period_id,paid_at,failure_reason&order=created_at.desc`)
const periods = await rest(`platform_billing_periods?school_id=eq.${schoolId}&period_start=eq.2026-09-01&select=period_start,period_end,amount_due,amount_paid,status,student_days`)
const [billing] = await rest(`platform_billing?school_id=eq.${schoolId}&select=billing_status,billing_status_changed_at,last_charged_at,last_charge_amount,last_charge_reference,next_charge_due_at`)
console.log('\n=== monthly_fee charges ===', JSON.stringify(charges, null, 2))
console.log('=== September period ===', JSON.stringify(periods, null, 2))
console.log('=== billing row ===', JSON.stringify(billing, null, 2))

// 5. Restore onboarding_at
await rest(`platform_billing?school_id=eq.${schoolId}`, {
  method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
  body: JSON.stringify({ onboarding_at: before.onboarding_at }),
})
console.log('\nrestored onboarding_at to', before.onboarding_at)
