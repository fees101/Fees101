// One-off: create Bursar/Accounts clerk/Class teacher test logins on Paystack
// Test School for the App Shell canvas persona-testing sweep. Bypasses the
// real invite-email flow (createUser + email_confirm, not inviteUserByEmail)
// since these are fictional QA personas with no real inbox.
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const PASSWORD = 'Fees101Test#2026'

const get = (p) => fetch(`${URL_}/rest/v1/${p}`, { headers: H }).then(r => r.json())
async function rest(method, path, body) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { ...H, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  try { const j = text ? JSON.parse(text) : null; return Array.isArray(j) ? j[0] : j } catch { return text }
}

const [school] = await get(`schools?name=eq.Paystack Test School&select=id,name`)
if (!school) throw new Error('Paystack Test School not found')
console.log('school_id:', school.id)

const roles = await get(`roles?school_id=eq.${school.id}&name=in.(Bursar,Accounts clerk,Class teacher)&select=id,name`)
console.log('roles:', roles)

const PERSONAS = [
  { roleName: 'Bursar', email: 'bursar-test@fees101.qa', name: 'Mr Adeyemi (Bursar test)' },
  { roleName: 'Accounts clerk', email: 'clerk-test@fees101.qa', name: 'Mr Balogun (Accounts clerk test)' },
  { roleName: 'Class teacher', email: 'teacher-test@fees101.qa', name: 'Mrs Okafor (Class teacher test)' },
]

for (const p of PERSONAS) {
  const role = roles.find(r => r.name === p.roleName)
  if (!role) { console.log('SKIP (no role found):', p.roleName); continue }

  const authRes = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email: p.email, password: PASSWORD, email_confirm: true }),
  })
  const authText = await authRes.text()
  if (!authRes.ok) { console.log('AUTH FAIL', p.email, authRes.status, authText.slice(0, 200)); continue }
  const userId = JSON.parse(authText).id

  const existing = await get(`users?id=eq.${userId}&select=id`)
  const userRow = { id: userId, school_id: school.id, name: p.name, email: p.email, role: 'bursar', role_id: role.id, is_active: true }
  if (existing.length) await rest('PATCH', `users?id=eq.${userId}`, userRow)
  else await rest('POST', 'users', userRow)

  console.log('CREATED', p.roleName, '->', p.email, '/', PASSWORD, 'role_id:', role.id)
}
