// Throwaway: verify the SUCCESS reconciliation + dunning ladder for slice 2,
// which the live charge can't exercise in test mode (mandate not reusable).
// Drives the webhook (the production settlement path) with a signed charge.success
// for the existing due_ charge, then forces an overdue state and checks the
// ladder escalates. Delete after testing.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]
}
const base = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const paystackSecret = env.PLATFORM_PAYSTACK_SECRET_KEY
const cronSecret = env.PLATFORM_BILLING_CRON_SECRET
const schoolId = process.argv[2] || 'd80be88f-c95b-4205-9698-75f806343d84'
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function rest(path, init) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: h, ...init })
  const text = await r.text(); if (!r.ok) { console.error('REST', path, r.status, text); process.exit(1) }
  return text ? JSON.parse(text) : null
}
function sign(body) { return crypto.createHmac('sha512', paystackSecret).update(body).digest('hex') }
async function webhook(obj) {
  const body = JSON.stringify(obj)
  const r = await fetch('http://localhost:3000/api/webhooks/platform-paystack', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(body) }, body,
  })
  return `${r.status} ${await r.text()}`
}

// --- A: success reconciliation via webhook -------------------------------
const [charge] = await rest(`platform_billing_charges?school_id=eq.${schoolId}&charged_by=eq.monthly_fee&select=paystack_reference,amount,period_id&order=created_at.desc&limit=1`)
console.log('due charge to settle:', charge)
console.log('webhook charge.success ->', await webhook({
  event: 'charge.success',
  data: { reference: charge.paystack_reference, amount: Math.round(charge.amount * 100), paid_at: new Date().toISOString() },
}))

const [chargeAfter] = await rest(`platform_billing_charges?paystack_reference=eq.${charge.paystack_reference}&select=status,paid_at`)
const [period] = await rest(`platform_billing_periods?id=eq.${charge.period_id}&select=amount_due,amount_paid,status`)
const [billingA] = await rest(`platform_billing?school_id=eq.${schoolId}&select=billing_status,last_charge_amount,last_charge_reference,next_charge_due_at`)
console.log('\n[A] charge:', chargeAfter)
console.log('[A] period:', period)
console.log('[A] billing:', billingA)

// --- B: dunning ladder escalates when overdue ----------------------------
const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000).toISOString()
await rest(`platform_billing?school_id=eq.${schoolId}`, {
  method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
  body: JSON.stringify({ billing_status: 'payment_due', next_charge_due_at: twentyDaysAgo }),
})
const cronRes = await fetch(`http://localhost:3000/api/cron/charge-mandates?secret=${encodeURIComponent(cronSecret)}`)
const cronJson = await cronRes.json()
console.log('\n[B] forced 20 days overdue, cron ladderMoves:', JSON.stringify(cronJson.ladderMoves))
const [billingB] = await rest(`platform_billing?school_id=eq.${schoolId}&select=billing_status`)
console.log('[B] billing_status now:', billingB.billing_status, '(expect suspended)')

// --- restore to a clean active state -------------------------------------
await rest(`platform_billing?school_id=eq.${schoolId}`, {
  method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
  body: JSON.stringify({ billing_status: 'active', next_charge_due_at: null }),
})
console.log('\nrestored billing_status=active, next_charge_due_at=null')
