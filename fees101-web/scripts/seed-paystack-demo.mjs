// Seed a clean, generous demo layer into the "Paystack Test School" so its
// pages (dashboard, students, invoices, payments, discounts, notifications,
// activity) show populated, internally-consistent data.
//
//   node scripts/seed-paystack-demo.mjs plan  -> show target + what would change
//   node scripts/seed-paystack-demo.mjs go    -> wipe prior demo + rebuild
//
// IDEMPOTENT & NON-DESTRUCTIVE to real data:
//   - demo families use "@demo.seed" emails
//   - demo students use "DEMO-" admission numbers
//   - demo invoices/payments/discounts hang off demo students (removed with them)
//   - demo admin_notifications are removed by their exact (unique) titles
//   - classes/sections are find-or-create (never deleted), so re-runs reuse them
// A re-run only ever removes/rebuilds ITS OWN rows. Existing students, invoices,
// classes, etc. are left alone. outstanding_amount is a GENERATED column, so it
// is never set here — Postgres derives it from total_amount/paid_amount/credit.
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

async function rest(method, path, body, extra = {}) {
  let lastErr
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${URL_}/rest/v1/${path}`, {
        method, headers: { ...H, Prefer: 'return=representation', ...extra },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      // Zscaler corporate proxy occasionally returns an HTML 403 interstitial;
      // that is a transient proxy blip, not an API error — retry it.
      const proxyBlip = !res.ok && /<html|zscaler/i.test(text)
      if (proxyBlip) { lastErr = new Error(`proxy ${res.status}`); await new Promise(r => setTimeout(r, 800 * (attempt + 1))); continue }
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`)
      try { return text ? JSON.parse(text) : null } catch { return text }
    } catch (e) {
      lastErr = e
      if (attempt === 4) throw e
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
    }
  }
  throw lastErr
}
// Zscaler blocks large POST bodies, so insert in small chunks.
async function insertMany(t, rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 10) {
    const chunk = rows.slice(i, i + 10)
    const res = await rest('POST', t, chunk)
    if (Array.isArray(res)) out.push(...res)
  }
  return out
}
const get = (p) => fetch(`${URL_}/rest/v1/${p}`, { headers: H }).then(r => r.json())
const del = (p) => fetch(`${URL_}/rest/v1/${p}`, { method: 'DELETE', headers: H }).catch(() => {})

const ago = (days, hours = 0) => new Date(Date.now() - days * 86400e3 - hours * 3600e3).toISOString()
const agoDate = (days) => ago(days).slice(0, 10)

// ---- Name pools (deterministic; no randomness so counts stay stable) --------
const FIRST = ['Amara','Chidi','Ngozi','Emeka','Fatima','Yusuf','Tunde','Zainab','Ifeoma','David',
  'Blessing','Samuel','Chioma','Kelechi','Aisha','Ibrahim','Grace','Daniel','Halima','Michael',
  'Peace','John','Esther','Victor','Mary','Joseph','Rukayat','Abdul','Favour','Bright',
  'Precious','Nnamdi','Temiloluwa','Oluwaseun','Chinaza','Ekene','Damilola','Adaeze','Musa','Chinwe',
  'Ayodele','Ngozika','Segun','Habiba','Uchechi','Kunle','Zara','Obinna','Titilayo','Ismail',
  'Onyeka','Bukola','Femi','Amina',' Chidinma'.trim(),'Gbenga','Nkechi','Sadiq','Yewande','Chuka',
  'Rita','Sola','Halimat','Tobenna','Ada','Wale','Ngoziamaka','Ridwan','Ebele','Kayode']
const LAST = ['Okafor','Adeyemi','Balogun','Bello','Adebayo','Musa','Nwosu','Eze','Ibrahim','Okonkwo',
  'Afolabi','Danjuma','Oladipo','Uche','Yakubu','Ogunleye','Chukwu','Aliyu','Obi','Lawal']
const TITLES = ['Mr.', 'Mrs.', 'Alhaji', 'Dr.', 'Mrs.', 'Mr.']

// ---- Class plan: find-or-create by name within the school -------------------
// (Primary 1 & 2 already exist; we add Primary 3-6 and a full Secondary section)
const CLASS_PLAN = [
  { section: 'Primary',   name: 'Primary 3', display_order: 3, tuition: 60000,  dev: 15000 },
  { section: 'Primary',   name: 'Primary 4', display_order: 4, tuition: 60000,  dev: 15000 },
  { section: 'Primary',   name: 'Primary 5', display_order: 5, tuition: 65000,  dev: 15000 },
  { section: 'Primary',   name: 'Primary 6', display_order: 6, tuition: 65000,  dev: 15000 },
  { section: 'Secondary', name: 'JSS 1',     display_order: 1, tuition: 90000,  dev: 20000 },
  { section: 'Secondary', name: 'JSS 2',     display_order: 2, tuition: 90000,  dev: 20000 },
  { section: 'Secondary', name: 'JSS 3',     display_order: 3, tuition: 95000,  dev: 20000 },
  { section: 'Secondary', name: 'SS 1',      display_order: 4, tuition: 110000, dev: 25000 },
  { section: 'Secondary', name: 'SS 2',      display_order: 5, tuition: 110000, dev: 25000 },
  { section: 'Secondary', name: 'SS 3',      display_order: 6, tuition: 120000, dev: 25000 },
]
const STUDENTS_PER_CLASS = 7   // -> 70 demo students

// ---- Demo admin notifications (deleted by these exact titles on re-run) -----
const NOTIFS = [
  { type: 'payment_received',          title: 'Payment received from Okafor family',            body: 'A Paystack payment of NGN 120,000 was received and applied to Amara Okafor for Second Term.',                    days: 0, hours: 2 },
  { type: 'suspicious_payment_amount', title: 'Unusually large payment received',                body: 'A Paystack payment of NGN 480,000 was received and applied (reference DEMO-RCPT-0031). Confirm this matches what was expected.', days: 0, hours: 6 },
  { type: 'discount_requested',        title: 'New discount request awaiting approval',          body: 'A sibling discount of 20% has been requested for Yusuf Bello. Review it in the Discounts queue.',               days: 1, hours: 0 },
  { type: 'invoices_generated',        title: 'Invoices generated for Second Term',              body: '70 invoices were generated for the Second Term billing cycle and are ready to send to parents.',              days: 2, hours: 0 },
  { type: 'message_delivery_failed',   title: 'Reminder could not be delivered',                 body: 'An overdue reminder to the Nwosu family could not be delivered on SMS (recipient on DND). Check message logs.', days: 3, hours: 0 },
  { type: 'payment_received',          title: 'Payment received from Adebayo family',            body: 'A Paystack payment of NGN 55,000 was received and applied to Tunde Adebayo for Second Term.',                 days: 4, hours: 0 },
]

async function findOrCreateSection(sid, name, display_order) {
  const existing = await get(`sections?school_id=eq.${sid}&name=eq.${encodeURIComponent(name)}&select=id,name&limit=1`)
  if (existing.length) return existing[0]
  return (await insertMany('sections', [{ school_id: sid, name, display_order }]))[0]
}
async function findOrCreateClass(sid, section_id, name, display_order) {
  const existing = await get(`classes?school_id=eq.${sid}&name=eq.${encodeURIComponent(name)}&select=id,name&limit=1`)
  if (existing.length) return existing[0]
  return (await insertMany('classes', [{ school_id: sid, section_id, name, display_order, is_active: true }]))[0]
}

async function main(mode) {
  // ---- Identify the Paystack school (STOP if not exactly one) --------------
  const schools = await get('schools?select=id,name,payment_provider')
  const cands = schools.filter(s => (s.name || '').toLowerCase().includes('paystack'))
  if (cands.length !== 1) {
    console.error(`STOP: expected exactly 1 school with "paystack" in the name, found ${cands.length}:`, cands.map(s => s.name))
    process.exit(1)
  }
  const target = cands[0], sid = target.id
  console.log(`Target school: "${target.name}" (${target.payment_provider})  ${sid}`)

  // ---- Active billing cycle -----------------------------------------------
  let cycle = (await get(`billing_cycles?school_id=eq.${sid}&status=eq.active&select=id,name&limit=1`))[0]
  if (!cycle) { console.error('STOP: no active billing cycle on this school.'); process.exit(1) }
  console.log(`Active billing cycle: "${cycle.name}" ${cycle.id}`)

  if (mode !== 'go') {
    const prior = (await get(`students?school_id=eq.${sid}&select=id,admission_number`))
      .filter(s => (s.admission_number || '').startsWith('DEMO-'))
    console.log(`\n[plan only] prior demo students found: ${prior.length}`)
    console.log(`[plan only] would ensure ${CLASS_PLAN.length} classes exist, add ${CLASS_PLAN.length * STUDENTS_PER_CLASS} students,`)
    console.log(`[plan only] one invoice each in "${cycle.name}", payments for the paid ones, ${7} discounts, ${NOTIFS.length} notifications.`)
    console.log('\nRe-run with `go` to execute.')
    return
  }

  // ---- Wipe prior demo rows (children first) ------------------------------
  const priorStudents = (await get(`students?school_id=eq.${sid}&select=id,admission_number`))
    .filter(s => (s.admission_number || '').startsWith('DEMO-'))
  if (priorStudents.length) {
    const ids = priorStudents.map(s => s.id).join(',')
    await del(`payments?student_id=in.(${ids})`)
    await del(`discounts?student_id=in.(${ids})`)
    await del(`invoices?student_id=in.(${ids})`)
    await del(`students?id=in.(${ids})`)
  }
  await del(`families?school_id=eq.${sid}&primary_parent_email=like.*@demo.seed`)
  for (const n of NOTIFS) await del(`admin_notifications?school_id=eq.${sid}&title=eq.${encodeURIComponent(n.title)}`)
  console.log(`Cleared prior demo: ${priorStudents.length} students (+ their invoices/payments/discounts), demo families & notifications.`)

  // ---- Classes / sections (find-or-create) --------------------------------
  const sectionCache = {}
  const secOrder = { Primary: 1, Nursery: 2, Secondary: 3 }
  const classes = []
  for (const c of CLASS_PLAN) {
    if (!sectionCache[c.section]) sectionCache[c.section] = await findOrCreateSection(sid, c.section, secOrder[c.section] || 9)
    const cls = await findOrCreateClass(sid, sectionCache[c.section].id, c.name, c.display_order)
    classes.push({ ...cls, section_id: sectionCache[c.section].id, plan: c })
  }
  console.log(`Ensured ${classes.length} classes across ${Object.keys(sectionCache).length} section(s).`)

  // ---- Build students + families ------------------------------------------
  const familyRows = [], studentDefs = []
  let sIdx = 0, prevFamKey = null
  for (const cls of classes) {
    for (let k = 0; k < STUDENTS_PER_CLASS; k++) {
      const first = FIRST[sIdx % FIRST.length]
      const last = LAST[sIdx % LAST.length]
      // ~1 in 6 shares the previous student's family (siblings)
      const sibling = k > 0 && sIdx % 6 === 5 && prevFamKey
      let famKey
      if (sibling) { famKey = prevFamKey }
      else {
        famKey = `${last}-${sIdx}`
        familyRows.push({
          school_id: sid,
          primary_parent_name: `${TITLES[sIdx % TITLES.length]} ${last}`,
          primary_parent_phone: `+23480${String(70000000 + sIdx).slice(-8)}`,
          primary_parent_email: `${last.toLowerCase()}.${sIdx}@demo.seed`,
          _key: famKey,
        })
        prevFamKey = famKey
      }
      studentDefs.push({ first, last, famKey, cls, sIdx, sibling })
      sIdx++
    }
  }
  const insertedFams = await insertMany('families', familyRows.map(({ _key, ...r }) => r))
  const famIdByKey = Object.fromEntries(familyRows.map((f, i) => [f._key, insertedFams[i].id]))
  console.log(`Inserted ${insertedFams.length} families.`)

  const studentRows = studentDefs.map((d) => ({
    school_id: sid, section_id: d.cls.section_id, class_id: d.cls.id,
    family_id: famIdByKey[d.famKey],
    first_name: d.first, last_name: d.last,
    admission_number: `DEMO-${String(d.sIdx + 1).padStart(4, '0')}`,
    status: 'active',
    special_category: d.sibling ? 'sibling' : null,
    admission_date: agoDate(30 + (d.sIdx % 20)),
    created_at: ago(30 + (d.sIdx % 20)),
  }))
  const students = await insertMany('students', studentRows)
  const stu = students.map((r, i) => ({ ...r, def: studentDefs[i] }))
  console.log(`Inserted ${students.length} students.`)

  // ---- Invoices (one per student, in the active cycle) --------------------
  const invPayload = stu.map((s, i) => {
    const { tuition, dev } = s.def.cls.plan
    const hasTransport = i % 4 === 0
    const transport = 25000
    const line_items = [
      { name: 'Tuition', amount: tuition, kind: 'required', discountable: true },
      { name: 'Development Levy', amount: dev, kind: 'required', discountable: true },
    ]
    if (hasTransport) line_items.push({ name: 'Transport', amount: transport, kind: 'opt_in', discountable: false })
    const subtotal = line_items.reduce((a, li) => a + li.amount, 0)
    const total = subtotal
    const r = i % 10
    // status mix: paid / partial / pending / overdue
    let paid, status, overdue = false
    if (r < 3) { paid = total; status = 'paid' }
    else if (r < 5) { paid = Math.round(total * 0.5); status = 'partial' }
    else if (r < 6) { paid = Math.round(total * 0.25); status = 'partial' }
    else if (r < 8) { paid = 0; status = 'pending' }
    else { paid = 0; status = 'overdue'; overdue = true }
    const genDays = overdue ? 40 + (i % 8) : (i * 3) % 38 + 2
    return {
      school_id: sid, student_id: s.id, billing_cycle_id: cycle.id,
      line_items, selected_extras_ids: [],
      discount_amount: 0, subtotal, total_amount: total, paid_amount: paid,
      credit_applied: 0,
      status,
      invoice_number: `INV-DEMO/${String(10001 + i)}`,
      generated_at: ago(genDays), sent_at: ago(genDays - 1),
      fully_paid_at: paid >= total && total > 0 ? ago(i % 14) : null,
      needs_resend: false, created_at: ago(genDays),
      _paid: paid, _idx: i,
    }
  })
  const invoices = await insertMany('invoices', invPayload.map(({ _paid, _idx, ...row }) => row))
  const invByStudent = Object.fromEntries(invoices.map(r => [r.student_id, r]))
  const statusCounts = invPayload.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})
  console.log(`Inserted ${invoices.length} invoices:`, statusCounts)

  // ---- Payments (matched Paystack; several dated today) -------------------
  const payRows = []
  let rcpt = 1
  stu.forEach((s, i) => {
    const paid = invPayload[i]._paid
    if (paid <= 0) return
    payRows.push({
      school_id: sid, invoice_id: invByStudent[s.id].id, student_id: s.id,
      amount: paid, method: 'provider_dva', provider: 'paystack',
      provider_reference: `DEMO-RCPT-${String(rcpt).padStart(4, '0')}`,
      provider_transaction_id: `DEMO-TXN-${String(rcpt).padStart(4, '0')}`,
      paid_at: ago(i % 14, i % 6), match_status: 'matched', created_at: ago(i % 14, i % 6),
    })
    rcpt++
  })
  await insertMany('payments', payRows)
  const paidToday = payRows.filter(p => p.paid_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length
  console.log(`Inserted ${payRows.length} payments (${paidToday} dated today).`)

  // ---- Discounts (pending queue + a couple applied) -----------------------
  // pick some unpaid/pending students for realistic pending requests
  const pendPicks = stu.filter((s, i) => invPayload[i].status === 'pending').slice(0, 5)
  const applPicks = stu.filter(s => s.def.sibling).slice(0, 2)
  const discRows = []
  const pendCats = [
    ['sibling_discount', 20, 'Second child enrolled this term; requesting the sibling discount per policy.'],
    ['scholarship', 50, 'Top of class last term; nominated for the academic scholarship.'],
    ['bursary', 40, 'Family financial hardship; requesting bursary support for the term.'],
    ['financial_hardship', 30, 'Loss of household income this year; requesting a hardship discount.'],
    ['sibling_discount', 20, 'Younger sibling of an existing pupil; applying for the sibling discount.'],
  ]
  pendPicks.forEach((s, i) => {
    const [category, amount, reason] = pendCats[i % pendCats.length]
    discRows.push({
      school_id: sid, invoice_id: invByStudent[s.id]?.id || null, student_id: s.id,
      amount, category, reason, status: 'pending', is_percentage: true, is_recurring: false,
      requested_at: ago(1 + i), approved_at: null, applied_at: null, created_at: ago(1 + i),
    })
  })
  applPicks.forEach((s, i) => {
    discRows.push({
      school_id: sid, invoice_id: invByStudent[s.id]?.id || null, student_id: s.id,
      amount: 10, category: 'sibling_discount',
      reason: 'Sibling discount approved and applied for the term.',
      status: 'applied', is_percentage: true, is_recurring: true,
      requested_at: ago(14 + i), approved_at: ago(12 + i), applied_at: ago(12 + i), created_at: ago(14 + i),
    })
  })
  await insertMany('discounts', discRows)
  console.log(`Inserted ${discRows.length} discounts (${pendPicks.length} pending, ${applPicks.length} applied).`)

  // ---- Admin notifications (unread) ---------------------------------------
  const notifRows = NOTIFS.map(n => ({
    school_id: sid, type: n.type, title: n.title, body: n.body,
    created_at: ago(n.days, n.hours), read_at: null,
  }))
  await insertMany('admin_notifications', notifRows)
  console.log(`Inserted ${notifRows.length} admin notifications (unread).`)

  // ---- Verify -------------------------------------------------------------
  const cnt = async (t, extra = '') => (await get(`${t}?school_id=eq.${sid}${extra}&select=id`)).length
  const demoStudents = (await get(`students?school_id=eq.${sid}&select=id,admission_number`)).filter(s => (s.admission_number || '').startsWith('DEMO-'))
  const demoIds = demoStudents.map(s => s.id)
  console.log('\n=== DONE — totals for this school ===')
  console.log('classes (total):        ', await cnt('classes'))
  console.log('sections (total):       ', await cnt('sections'))
  console.log('demo students:          ', demoStudents.length)
  console.log('students (total):       ', await cnt('students'))
  console.log('demo families:          ', (await get(`families?school_id=eq.${sid}&primary_parent_email=like.*@demo.seed&select=id`)).length)
  console.log('demo invoices:          ', demoIds.length ? (await get(`invoices?student_id=in.(${demoIds.join(',')})&select=id`)).length : 0)
  console.log('demo payments:          ', demoIds.length ? (await get(`payments?student_id=in.(${demoIds.join(',')})&select=id`)).length : 0)
  console.log('demo discounts:         ', demoIds.length ? (await get(`discounts?student_id=in.(${demoIds.join(',')})&select=id`)).length : 0)
  console.log('pending discounts (all):', await cnt('discounts', '&status=eq.pending'))
  console.log('unread notifications:   ', await cnt('admin_notifications', '&read_at=is.null'))
}

await main(process.argv[2])
