// Seed realistic, recent, human-readable data for the Recent Activity page
// (/activity) INTO AN EXISTING SCHOOL — no relogin/repointing needed.
//
//   node scripts/seed-activity.mjs plan   -> show the target school, no writes
//   node scripts/seed-activity.mjs go     -> wipe prior seed + rebuild
//
// Targets the Paystack school by default (the one you're logged into). It is
// idempotent and NON-DESTRUCTIVE to real data: every seeded student uses an
// "ACT-" admission number and every family an "@activity.seed" email, so a
// re-run only ever removes/rebuilds ITS OWN rows. Existing students (e.g.
// Abdullahi) and the school's setup are left alone.
//
// Actor columns are left NULL: public.users is FK'd to auth.users so we can't
// invent staff here — and payments then read as "Automatic", which is exactly
// right for DVA/webhook collections (the common real case).
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

async function rest(method, path, body, extra = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { ...H, Prefer: 'return=representation', ...extra },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`)
  try { const j = text ? JSON.parse(text) : null; return j } catch { return text }
}
const insert = (t, row) => rest('POST', t, row).then(r => Array.isArray(r) ? r[0] : r)
const insertMany = (t, rows) => rest('POST', t, rows)
const get = (p) => fetch(`${URL_}/rest/v1/${p}`, { headers: H }).then(r => r.json())
const del = (p) => fetch(`${URL_}/rest/v1/${p}`, { method: 'DELETE', headers: H }).catch(() => {})

// ISO timestamp N days (and optional H hours) ago.
const ago = (days, hours = 0) => new Date(Date.now() - days * 86400e3 - hours * 3600e3).toISOString()
const agoDate = (days) => ago(days).slice(0, 10)

// --- Families (real Nigerian parent names; @activity.seed marks them ours) ---
const FAMILIES = [
  { key: 'okafor',  name: 'Mr. Chukwuma Okafor', phone: '+2348030000001' },
  { key: 'adeyemi', name: 'Mrs. Bukola Adeyemi', phone: '+2348030000002' },
  { key: 'balogun', name: 'Mr. Segun Balogun',   phone: '+2348030000003' },
  { key: 'bello',   name: 'Alhaji Musa Bello',   phone: '+2348030000004' },
  { key: 'adebayo', name: 'Mr. Kunle Adebayo',   phone: '+2348030000005' },
  { key: 'musa',    name: 'Mrs. Aisha Musa',     phone: '+2348030000006' },
  { key: 'nwosu',   name: 'Dr. Chinelo Nwosu',   phone: '+2348030000007' },
  { key: 'eze',     name: 'Mr. Obinna Eze',      phone: '+2348030000008' },
]

// --- Students (siblings share a family; last two are recent adds) -----------
const STUDENTS = [
  { first: 'Amara',    last: 'Okafor',  fam: 'okafor',  cat: null,          createdDays: 47 },
  { first: 'Chidi',    last: 'Okafor',  fam: 'okafor',  cat: 'sibling',     createdDays: 47 },
  { first: 'Ngozi',    last: 'Adeyemi', fam: 'adeyemi', cat: null,          createdDays: 45 },
  { first: 'Emeka',    last: 'Balogun', fam: 'balogun', cat: null,          createdDays: 44 },
  { first: 'Fatima',   last: 'Bello',   fam: 'bello',   cat: 'scholarship', createdDays: 43 },
  { first: 'Yusuf',    last: 'Bello',   fam: 'bello',   cat: 'sibling',     createdDays: 43 },
  { first: 'Tunde',    last: 'Adebayo', fam: 'adebayo', cat: 'staff_child', createdDays: 40 },
  { first: 'Zainab',   last: 'Musa',    fam: 'musa',    cat: null,          createdDays: 38 },
  { first: 'Ifeoma',   last: 'Nwosu',   fam: 'nwosu',   cat: null,          createdDays: 35 },
  { first: 'David',    last: 'Eze',     fam: 'eze',     cat: null,          createdDays: 30 },
  { first: 'Blessing', last: 'Adeyemi', fam: 'adeyemi', cat: 'bursary',     createdDays: 2 },
  { first: 'Samuel',   last: 'Adebayo', fam: 'adebayo', cat: null,          createdDays: 1 },
]

async function main(mode) {
  const schools = await get('schools?select=id,name,payment_provider')
  const target = schools.find(s => s.payment_provider === 'paystack') || schools[0]
  if (!target) throw new Error('No schools found.')
  const sid = target.id
  console.log(`Target school: "${target.name}" (${target.payment_provider || 'no provider'})  ${sid}`)

  // ---- Existing academic structure to hang the data on --------------------
  const classes = await get(`classes?school_id=eq.${sid}&select=id,name&order=display_order`)
  const sections = await get(`sections?school_id=eq.${sid}&select=id&order=display_order`)
  let cycle = (await get(`billing_cycles?school_id=eq.${sid}&status=eq.active&select=id,name&limit=1`))[0]
    || (await get(`billing_cycles?school_id=eq.${sid}&select=id,name&limit=1`))[0]
  if (!classes.length || !sections.length) throw new Error('School has no classes/sections to attach students to.')
  if (!cycle) throw new Error('School has no billing cycle to attach invoices to.')
  console.log(`Using ${classes.length} class(es), billing cycle "${cycle.name}".`)

  // ---- Find any prior seed rows (marked by ACT- / @activity.seed) ----------
  const priorStudents = (await get(`students?school_id=eq.${sid}&select=id,admission_number`))
    .filter(s => (s.admission_number || '').startsWith('ACT-'))
  const priorFamilies = (await get(`families?school_id=eq.${sid}&select=id,primary_parent_email`))
    .filter(f => (f.primary_parent_email || '').endsWith('@activity.seed'))

  if (mode !== 'go') {
    console.log(`\n[plan only] would REMOVE prior seed: ${priorStudents.length} student(s), ${priorFamilies.length} family(ies) (+ their invoices/payments/messages/discounts)`)
    console.log(`[plan only] would ADD: ${FAMILIES.length} families, ${STUDENTS.length} students, invoices/payments/messages/discounts across the last ~47 days`)
    console.log('\nRe-run with `go` to execute.')
    return
  }

  // ---- Wipe prior seed (children first) -----------------------------------
  if (priorStudents.length) {
    const ids = priorStudents.map(s => s.id).join(',')
    for (const t of ['message_logs?related_student_id', 'payments?student_id', 'discounts?student_id', 'invoices?student_id']) {
      const [tbl, col] = t.split('?')
      await del(`${tbl}?${col}=in.(${ids})`)
    }
    await del(`students?id=in.(${ids})`)
  }
  if (priorFamilies.length) await del(`families?id=in.(${priorFamilies.map(f => f.id).join(',')})`)
  console.log('Prior seed cleared.')

  // ---- Families -----------------------------------------------------------
  const famRows = await insertMany('families', FAMILIES.map(f => ({
    school_id: sid, primary_parent_name: f.name, primary_parent_phone: f.phone,
    primary_parent_email: `${f.key}@activity.seed`,
  })))
  const famId = Object.fromEntries(FAMILIES.map((f, i) => [f.key, famRows[i].id]))

  // ---- Students -----------------------------------------------------------
  const studentRows = await insertMany('students', STUDENTS.map((s, i) => ({
    school_id: sid, section_id: sections[0].id,
    class_id: classes[i % classes.length].id, family_id: famId[s.fam],
    first_name: s.first, last_name: s.last,
    admission_number: `ACT-${String(i + 1).padStart(4, '0')}`,
    status: 'active', special_category: s.cat,
    admission_date: agoDate(s.createdDays), created_at: ago(s.createdDays),
  })))
  const stu = studentRows.map((r, i) => ({ ...r, meta: STUDENTS[i], fam: STUDENTS[i].fam }))
  const phoneOf = (s) => FAMILIES.find(f => f.key === s.fam).phone
  console.log(`Inserted ${famRows.length} families, ${studentRows.length} students.`)

  // ---- Invoices (one per student), spread over the last ~4-42 days ---------
  const TUITION = [120000, 140000, 180000, 200000]
  const invoicePayload = stu.map((s, i) => {
    const isNew = s.meta.createdDays <= 2
    const genDays = isNew ? 1 : ((i * 7) % 38) + 4
    const tuition = TUITION[i % TUITION.length]
    const total = tuition + 20000
    // pay pattern: some full, some half, some quarter, some none; new students unpaid
    const r = i % 10
    const paid = isNew ? 0 : r < 4 ? total : r < 7 ? total * 0.5 : r < 9 ? total * 0.25 : 0
    return {
      school_id: sid, student_id: s.id, billing_cycle_id: cycle.id,
      line_items: [
        { name: 'Tuition', amount: tuition, kind: 'required' },
        { name: 'Development Levy', amount: 20000, kind: 'required' },
      ],
      discount_amount: 0, subtotal: total, total_amount: total, paid_amount: paid,
      status: total > 0 && paid >= total ? 'paid' : paid > 0 ? 'partial' : 'pending',
      sent_at: isNew ? null : ago(genDays - 1),
      generated_at: ago(genDays), created_at: ago(genDays),
      _paid: paid, _genDays: genDays,
    }
  })
  const invRows = await insertMany('invoices',
    invoicePayload.map(({ _paid, _genDays, ...row }) => row))
  const invByStudent = Object.fromEntries(invRows.map(r => [r.student_id, r.id]))
  console.log(`Inserted ${invRows.length} invoices.`)

  // ---- Payments (automatic DVA, matched); newest gets today's date ---------
  const paidList = stu.map((s, i) => ({ s, i, amt: invoicePayload[i]._paid }))
    .filter(p => p.amt > 0)
    .sort((a, b) => b.amt - a.amt)
  const payRows = paidList.map((p, rn) => ({
    school_id: sid, invoice_id: invByStudent[p.s.id], student_id: p.s.id,
    amount: p.amt, method: 'provider_dva', provider: 'paystack',
    provider_reference: `RCPT-${String(rn + 1).padStart(4, '0')}`,
    paid_at: ago(Math.min(rn, 25)), match_status: 'matched', created_at: ago(Math.min(rn, 25)),
  }))
  if (payRows.length) await insertMany('payments', payRows)
  console.log(`Inserted ${payRows.length} payments (incl. today & yesterday).`)

  // ---- Messages (reminders / receipts / deliveries / manual / one failed) --
  const byName = Object.fromEntries(stu.map(s => [s.meta.first, s]))
  const msg = (first, type, content, status, days, hours, opts = {}) => {
    const s = byName[first]
    return {
      school_id: sid, direction: 'outbound', message_type: type, content,
      channel: opts.email ? 'email' : 'sms', status,
      failed_reason: opts.failed || null,
      recipient_phone: opts.email ? null : phoneOf(s.meta),
      recipient_email: opts.email ? `${s.fam}@activity.seed` : null,
      related_student_id: s.id, sent_at: ago(days, hours), created_at: ago(days, hours),
    }
  }
  const messages = [
    msg('Amara',  'receipt',          'Payment of NGN 140,000 received for Amara Okafor. Receipt RCPT-0001. Thank you.', 'delivered', 0, 2),
    msg('David',  'receipt',          'Payment received for David Eze. Receipt RCPT-0002. Thank you.',                   'delivered', 0, 18),
    msg('Fatima', 'receipt',          'Payment received for Fatima Bello. Receipt RCPT-0003. Thank you.',                'delivered', 1, 0),
    msg('Emeka',  'reminder_overdue', 'Reminder: fees for Emeka Balogun are overdue. Please pay to avoid disruption.',   'delivered', 1, 0),
    msg('Ifeoma', 'reminder_overdue', 'Reminder: fees for Ifeoma Nwosu are overdue.',                                   'failed',    2, 0, { failed: 'Recipient on DND' }),
    msg('Tunde',  'reminder_overdue', 'Reminder: fees for Tunde Adebayo are overdue.',                                  'delivered', 3, 0),
    msg('Ngozi',  'reminder_due',     'Reminder: fees for Ngozi Adeyemi are due soon.',                                 'sent',      5, 0),
    msg('Zainab', 'reminder_due',     'Reminder: fees for Zainab Musa are due soon.',                                   'delivered', 6, 0),
    msg('David',  'reminder_advance', 'Upcoming: fees for David Eze will be due next week.',                            'sent',      8, 0),
    msg('Chidi',  'invoice_full',     'Invoice for Chidi Okafor for this term is ready. Total NGN 160,000.',            'delivered', 10, 0),
    msg('Fatima', 'invoice_full',     'Invoice for Fatima Bello for this term is ready.',                               'delivered', 12, 0),
    msg('Tunde',  'invoice_full',     'Invoice for Tunde Adebayo for this term is ready.',                              'sent',      12, 0, { email: true }),
    msg('Yusuf',  'manual',           "Dear parent, please visit the bursary regarding Yusuf Bello's account.",         'delivered', 15, 0),
    msg('Ifeoma', 'reminder_advance', 'Upcoming: fees for Ifeoma Nwosu will be due next week.',                        'delivered', 16, 0),
  ]
  await insertMany('message_logs', messages)
  console.log(`Inserted ${messages.length} messages.`)

  // ---- Discounts (full lifecycle: requested / approved / rejected / applied)
  const disc = (first, amount, category, reason, status, extra) => {
    const s = byName[first]
    return {
      school_id: sid, invoice_id: invByStudent[s.id], student_id: s.id,
      amount, category, reason, status, is_percentage: true,
      is_recurring: extra.recurring || false,
      requested_at: extra.requested || null, approved_at: extra.approved || null,
      rejected_at: extra.rejected || null, rejection_reason: extra.rejectionReason || null,
      applied_at: extra.applied || null, created_at: extra.requested || ago(2),
    }
  }
  const discounts = [
    disc('Chidi',    10, 'sibling_discount',   'Second child in the school, requesting the sibling discount per policy.', 'pending',  { requested: ago(2) }),
    disc('Yusuf',    10, 'sibling_discount',   'Younger sibling of Fatima Bello; applying for the sibling discount.',      'pending',  { requested: ago(4) }),
    disc('Fatima',   50, 'scholarship',        'Outstanding academic performance scholarship awarded for the term.',      'approved', { requested: ago(12), approved: ago(10), recurring: true }),
    disc('Blessing', 40, 'bursary',            'Family financial hardship reviewed and approved by the administrator.',    'approved', { requested: ago(9), approved: ago(7) }),
    disc('David',    30, 'financial_hardship', 'Requesting hardship discount due to loss of family income this year.',     'rejected', { requested: ago(8), rejected: ago(6), rejectionReason: 'Insufficient supporting documentation provided.' }),
    disc('Tunde',    50, 'staff_child',        'Child of a member of staff; staff discount applied to the invoice.',       'applied',  { requested: ago(20), approved: ago(18), applied: ago(12), recurring: true }),
  ]
  await insertMany('discounts', discounts)
  console.log(`Inserted ${discounts.length} discounts.`)

  // ---- Sanity check via the view ------------------------------------------
  const feed = await get(`activity_feed?school_id=eq.${sid}&select=category`)
  const counts = feed.reduce((a, r) => (a[r.category] = (a[r.category] || 0) + 1, a), {})
  console.log('\n=== DONE ===')
  console.log(`activity_feed rows for this school:`, counts, `(total ${feed.length})`)
  console.log(`Open /activity while logged into "${target.name}".`)
}

await main(process.argv[2])
