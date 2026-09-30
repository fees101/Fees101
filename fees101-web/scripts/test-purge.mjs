// Throwaway purge test for the Data & privacy deletion cron.
//
//   node scripts/test-purge.mjs seed     -> creates an ISOLATED test school with
//                                           sample data + an auth user, and a
//                                           deletion request dated in the past.
//                                           Prints the test school id.
//   node scripts/test-purge.mjs verify <id>
//                                        -> checks the school + all its data are
//                                           gone, the auth user is deleted, and
//                                           anonymised financials were archived.
//
// Between the two, run the actual cron route (dev server must be running):
//   curl -X POST localhost:3000/api/admin/purge-deletions -H "x-purge-secret: $PURGE_SECRET"
//
// SAFETY: this only ever creates/reads rows tagged with the marker below. It
// never schedules or deletes any pre-existing school. Never point the purge cron
// at a real school.

import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const MARKER = 'PURGE-TEST'

async function rest(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { ...H, Prefer: 'return=representation', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return json
}

async function insert(table, row) {
  const out = await rest('POST', table, row)
  return Array.isArray(out) ? out[0] : out
}

async function count(table, schoolCol, id) {
  const res = await fetch(`${URL_}/rest/v1/${table}?${schoolCol}=eq.${id}&select=*`, {
    method: 'GET',
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = res.headers.get('content-range') || '*/0'
  return parseInt(cr.split('/')[1] || '0', 10)
}

async function cleanupSchool(schoolId, userId) {
  const tables = ['admin_notifications', 'message_logs', 'payments', 'discounts',
    'student_fee_adjustments', 'audit_log', 'report_downloads', 'invoices', 'fee_items',
    'students', 'billing_cycles', 'sessions', 'classes', 'sections', 'families',
    'users', 'roles', 'school_deletion_requests']
  for (const t of tables) {
    await fetch(`${URL_}/rest/v1/${t}?school_id=eq.${schoolId}`, { method: 'DELETE', headers: H }).catch(() => {})
  }
  await fetch(`${URL_}/rest/v1/schools?id=eq.${schoolId}`, { method: 'DELETE', headers: H }).catch(() => {})
  if (userId) await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: H }).catch(() => {})
}

async function seed() {
  console.log('Seeding isolated throwaway school…')
  let schoolId, userId
  try {
    return await seedInner(id => { schoolId = id }, id => { userId = id })
  } catch (e) {
    console.error('\nSeed failed — cleaning up partial rows for', schoolId)
    if (schoolId) await cleanupSchool(schoolId, userId)
    throw e
  }
}

async function seedInner(setSchool, setUser) {
  const school = await insert('schools', {
    name: `${MARKER} School ${Date.now()}`,
    subscription_status: 'active',
  })
  const schoolId = school.id
  setSchool(schoolId)
  console.log('  school_id:', schoolId)

  // Auth user + public.users. A trigger may already create the public row on
  // signup, so upsert-by-id after the auth call.
  const email = `purge-test-${Date.now()}@example.com`
  const authRes = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email, password: 'PurgeTest!2026', email_confirm: true }),
  })
  const authText = await authRes.text()
  if (!authRes.ok) throw new Error(`auth create -> ${authRes.status}: ${authText.slice(0, 300)}`)
  const authUser = JSON.parse(authText)
  const userId = authUser.id
  setUser(userId)
  console.log('  auth user:', userId, email)

  const existing = await fetch(`${URL_}/rest/v1/users?id=eq.${userId}&select=id`, { headers: H }).then(r => r.json())
  if (existing.length) {
    await rest('PATCH', `users?id=eq.${userId}`, { school_id: schoolId, name: `${MARKER} Owner`, email, role: 'school_admin', is_active: true })
  } else {
    await insert('users', { id: userId, school_id: schoolId, name: `${MARKER} Owner`, email, role: 'school_admin', is_active: true })
  }

  // Minimal but representative relational data.
  const section = await insert('sections', { school_id: schoolId, name: 'Primary', display_order: 1 })
  const klass = await insert('classes', { school_id: schoolId, section_id: section.id, name: 'P1', display_order: 1 })
  const session = await insert('sessions', { school_id: schoolId, name: '2025/2026', status: 'active', start_date: '2025-09-01', end_date: '2026-07-31' })
  const cycle = await insert('billing_cycles', { school_id: schoolId, session_id: session.id, name: 'Term 1', status: 'active', start_date: '2025-09-01', end_date: '2025-12-15', due_date: '2025-09-30' })
  const family = await insert('families', { school_id: schoolId, primary_parent_name: 'Test Parent', primary_parent_phone: '08000000000' })
  const student = await insert('students', {
    school_id: schoolId, section_id: section.id, class_id: klass.id, family_id: family.id,
    first_name: 'Test', last_name: 'Student', admission_number: `PT-${Date.now()}`, status: 'active',
  })
  await insert('fee_items', { school_id: schoolId, billing_cycle_id: cycle.id, class_id: klass.id, name: 'Tuition', amount: 50000, is_mandatory: true })
  const invoice = await insert('invoices', {
    school_id: schoolId, student_id: student.id, billing_cycle_id: cycle.id,
    subtotal: 50000, total_amount: 50000, paid_amount: 20000, status: 'partial',
  })
  await insert('payments', {
    school_id: schoolId, invoice_id: invoice.id, student_id: student.id,
    amount: 20000, method: 'provider_dva', provider: 'monnify', match_status: 'matched',
    provider_reference: 'TEST-REF-1', sender_name: 'Test Parent', paid_at: new Date().toISOString(),
  })
  await insert('message_logs', {
    school_id: schoolId, direction: 'outbound', message_type: 'reminder_due', channel: 'sms',
    provider: 'termii', recipient_phone: '08000000000', content: 'Test reminder', status: 'sent',
  })
  await insert('audit_log', {
    school_id: schoolId, actor_id: userId, actor_name: `${MARKER} Owner`,
    action: 'test.seeded', summary: 'seed row', target_type: 'school', target_id: schoolId,
  })

  // Deletion request: scheduled_for in the PAST (due now), financials retained.
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const future = new Date(Date.now() + 6 * 365 * 24 * 3600 * 1000).toISOString()
  await insert('school_deletion_requests', {
    school_id: schoolId, school_name: school.name, status: 'scheduled',
    requested_by: userId, requested_by_name: `${MARKER} Owner`, requested_by_email: email,
    acknowledgement: 'seed', scheduled_for: past, financial_purge_at: future,
  })

  console.log('\nSeeded. Now run the cron:')
  console.log(`  curl -X POST localhost:3000/api/admin/purge-deletions -H "x-purge-secret: $PURGE_SECRET"`)
  console.log(`\nThen verify:`)
  console.log(`  node scripts/test-purge.mjs verify ${schoolId}`)
  console.log(`\n(auth user to confirm deleted: ${userId})`)
}

async function verify(schoolId) {
  if (!schoolId) throw new Error('usage: verify <school_id>')
  console.log('Verifying purge of', schoolId, '\n')

  const tables = ['students', 'families', 'classes', 'sections', 'sessions', 'billing_cycles',
    'fee_items', 'invoices', 'payments', 'discounts', 'message_logs', 'admin_notifications',
    'audit_log', 'report_downloads', 'users', 'roles']
  let leftover = 0
  for (const t of tables) {
    const n = await count(t, 'school_id', schoolId)
    if (n > 0) { console.log(`  ✗ ${t}: ${n} rows STILL PRESENT`); leftover += n }
  }

  // schools row gone?
  const schoolRows = await fetch(`${URL_}/rest/v1/schools?id=eq.${schoolId}&select=id`, { headers: H }).then(r => r.json())
  const schoolGone = schoolRows.length === 0
  console.log(`  ${schoolGone ? '✓' : '✗'} schools row ${schoolGone ? 'deleted' : 'STILL PRESENT'}`)

  // archived financials present?
  const archived = await count('archived_financials', 'original_school_id', schoolId)
  console.log(`  ${archived > 0 ? '✓' : '✗'} archived_financials: ${archived} row(s) kept (expect >= 2: 1 invoice + 1 payment)`)

  // deletion request marked completed?
  const reqs = await fetch(`${URL_}/rest/v1/school_deletion_requests?school_id=eq.${schoolId}&select=status,archived_record_count`, { headers: H }).then(r => r.json())
  const req = reqs[0]
  console.log(`  ${req?.status === 'completed' ? '✓' : '✗'} deletion request status: ${req?.status} (archived_record_count=${req?.archived_record_count})`)

  console.log(`\n  → also confirm the auth user 404s (printed by seed).`)
  console.log(`\n${leftover === 0 && schoolGone && archived > 0 ? 'PASS ✅' : 'CHECK ABOVE ✗'}`)
}

async function rpc(fn, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: H, body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`rpc ${fn} -> ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// Mirrors runPurge() in the cron route, but SCOPED TO ONE SCHOOL by id — a
// safety rail so a local test can never touch a real school's due request.
async function run(schoolId) {
  if (!schoolId) throw new Error('usage: run <school_id>')
  const reqs = await fetch(
    `${URL_}/rest/v1/school_deletion_requests?school_id=eq.${schoolId}&status=eq.scheduled&select=id,school_id,financial_purge_at,scheduled_for`,
    { headers: H },
  ).then(r => r.json())
  const req = reqs[0]
  if (!req) { console.log('No scheduled request for', schoolId); return }
  if (new Date(req.scheduled_for) > new Date()) { console.log('Not due yet:', req.scheduled_for); return }

  const userRows = await fetch(`${URL_}/rest/v1/users?school_id=eq.${schoolId}&select=id`, { headers: H }).then(r => r.json())
  const authIds = userRows.map(u => u.id)
  console.log('  auth ids to delete:', authIds.length)

  const archived = await rpc('archive_and_delete_school', { p_school_id: schoolId, p_purge_after: req.financial_purge_at })
  console.log('  archived rows:', archived)

  let authDeleted = 0
  for (const id of authIds) {
    const r = await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H })
    if (r.ok) authDeleted++
  }
  console.log('  auth users deleted:', authDeleted)

  await rest('PATCH', `school_deletion_requests?id=eq.${req.id}`,
    { status: 'completed', completed_at: new Date().toISOString(), archived_record_count: archived })

  const purged = await rpc('purge_expired_financials')
  console.log('  expired financials purged:', purged)
  console.log('Done. Now: node scripts/test-purge.mjs verify', schoolId)
}

const [cmd, arg, arg2] = process.argv.slice(2)
if (cmd === 'seed') await seed()
else if (cmd === 'run') await run(arg)
else if (cmd === 'verify') await verify(arg)
else if (cmd === 'clean') { await cleanupSchool(arg, arg2); console.log('cleaned', arg) }
else console.log('usage: node scripts/test-purge.mjs seed | run <school_id> | verify <school_id> | clean <school_id> [auth_user_id]')
