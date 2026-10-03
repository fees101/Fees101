// Throwaway: verify slice-1 billing state via PostgREST REST (no supabase-js,
// avoids the Node 20 realtime/websocket issue). Delete after testing.
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]
}
const base = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const schoolId = process.argv[2] || 'd80be88f-c95b-4205-9698-75f806343d84'
const h = { apikey: key, Authorization: `Bearer ${key}` }

async function q(path) {
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: h })
  if (!r.ok) { console.error(path, r.status, await r.text()); process.exit(1) }
  return r.json()
}

const billingCols = 'setup_fee_amount,setup_fee_status,setup_fee_reference,setup_fee_paid_at,mandate_authorization_code,mandate_email,mandate_status,mandate_authorized_at,billing_connected_at,onboarding_at,terms_accepted_at,terms_accepted_by,terms_version'
const [billing] = await q(`platform_billing?school_id=eq.${schoolId}&select=${billingCols}`)
const charges = await q(`platform_billing_charges?school_id=eq.${schoolId}&select=amount,status,method,charged_by,paystack_reference,paid_at&order=paid_at.desc`)

if (billing?.mandate_authorization_code) {
  const c = billing.mandate_authorization_code
  billing.mandate_authorization_code = c.slice(0, 8) + '…(' + c.length + ' chars)'
}

console.log('=== platform_billing ===')
console.log(JSON.stringify(billing, null, 2))
console.log('=== platform_billing_charges ===')
console.log(JSON.stringify(charges, null, 2))
