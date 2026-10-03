// Throwaway: exercise the platform-paystack webhook locally with signed bodies.
// Delete after testing.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2]
}
const secret = env.PLATFORM_PAYSTACK_SECRET_KEY
const ENDPOINT = 'http://localhost:3000/api/webhooks/platform-paystack'
const schoolId = process.argv[2] || 'd80be88f-c95b-4205-9698-75f806343d84'
const authCode = process.argv[3] // optional: real mandate auth code to test activation

function sign(body) { return crypto.createHmac('sha512', secret).update(body).digest('hex') }

async function post(label, obj, { badSig = false } = {}) {
  const body = JSON.stringify(obj)
  const sig = badSig ? 'deadbeef' : sign(body)
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': sig },
    body,
  })
  const text = await r.text()
  console.log(`\n[${label}] HTTP ${r.status} ${text}`)
}

// 1. Invalid signature -> 401
await post('bad-signature', { event: 'charge.success', data: { reference: 'setup_x_1' } }, { badSig: true })

// 2. Idempotent setup-fee charge.success (row already exists from the live test)
await post('charge.success (setup, idempotent)', {
  event: 'charge.success',
  data: { reference: `setup_${schoolId}_1790873441886`, amount: 10000, paid_at: '2026-10-01T16:51:57Z' },
})

// 3. Mandate activation (only runs if you pass the auth code as arg 2)
if (authCode) {
  await post('mandate active', {
    event: 'direct_debit.authorization.active',
    data: { authorization_code: authCode, customer: { email: 'paystack@school.com' } },
  })
}

// 4. Unknown event -> 200 ignored
await post('unknown event', { event: 'transfer.success', data: {} })
