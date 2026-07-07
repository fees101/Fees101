// Manual end-to-end test for Slice 3 (payment application logic) — not part
// of the app or CI. Exercises the real webhook endpoint against a throwaway
// school/student/invoices, then tears everything down. Requires the dev
// server running on localhost:3000.
//
// Usage:
//   MONNIFY_TEST_API_KEY=... MONNIFY_TEST_SECRET_KEY=... MONNIFY_TEST_CONTRACT_CODE=... \
//     npx tsx scripts/test-payment-cascade.ts
//
// Covers, in one scenario:
//   - cascading a single payment across multiple outstanding invoices, oldest term first
//   - a second payment overflowing into students.credit_balance once every open invoice is paid
//   - a closed-term invoice being completely excluded from the cascade (its outstanding
//     balance already lives on a newer invoice via carry-forward — paying it directly
//     would double-count the same debt)
//   - a duplicate webhook redelivery being rejected without double-applying
//
// The "already partially paid" invoice is seeded via a REAL payments row (not a
// hand-set paid_amount), so the recalculate_invoice_payment_status trigger has
// something real to sum and the predicted numbers below match exactly — no
// phantom-balance correction needed, unlike the first draft of this test.

import { createServiceRoleClient } from '../src/lib/supabase/serviceRole'
import { encryptCredential } from '../src/lib/payments/encryption'
import crypto from 'crypto'

const API_KEY = process.env.MONNIFY_TEST_API_KEY
const SECRET_KEY = process.env.MONNIFY_TEST_SECRET_KEY
const CONTRACT_CODE = process.env.MONNIFY_TEST_CONTRACT_CODE
const BASE_URL = 'http://localhost:3000'

if (!API_KEY || !SECRET_KEY || !CONTRACT_CODE) {
  console.error('Set MONNIFY_TEST_API_KEY, MONNIFY_TEST_SECRET_KEY, MONNIFY_TEST_CONTRACT_CODE and re-run.')
  process.exit(1)
}

function makePayload(dvaRef: string, transactionReference: string, amountPaid: number) {
  return {
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      product: { reference: dvaRef, type: 'RESERVED_ACCOUNT' },
      transactionReference,
      paymentReference: transactionReference,
      paidOn: '2026-07-07 16:00:00.000000000',
      paymentDescription: 'Slice 3 cascade test',
      metaData: {},
      paymentSourceInformation: [{ bankCode: '057', amountPaid, accountName: 'Cascade Test Payer', sessionId: 'sim', accountNumber: '0000000000' }],
      destinationAccountInformation: { bankCode: '035', bankName: 'Wema bank', accountNumber: '1234567890' },
      amountPaid,
      totalPayable: amountPaid,
      cardDetails: {},
      paymentMethod: 'ACCOUNT_TRANSFER',
      currency: 'NGN',
      settlementAmount: String(amountPaid - 10),
      paymentStatus: 'PAID',
      paymentScope: 'LOCAL',
      customer: { name: 'Cascade Test Payer', email: 'cascade@example.com' },
    },
  }
}

async function sendWebhook(url: string, payload: any) {
  const rawBody = JSON.stringify(payload)
  const signature = crypto.createHmac('sha512', SECRET_KEY!).update(rawBody).digest('hex')
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'monnify-signature': signature }, body: rawBody })
  return { status: res.status, body: await res.json() }
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`)
  if (!ok) process.exitCode = 1
}

function need<T>(data: T | null): T {
  if (data === null) throw new Error('Expected a row back from Supabase, got null')
  return data
}

async function main() {
  const supabase = createServiceRoleClient()

  console.log('=== setup ===')
  const school = need((await supabase.from('schools').insert({
    name: 'Slice 3 Cascade Test School (delete me)',
    payment_provider: 'monnify',
    provider_api_key: encryptCredential(API_KEY!),
    provider_secret_key: encryptCredential(SECRET_KEY!),
    provider_contract_code: CONTRACT_CODE!,
  }).select('id').single()).data)

  const section = need((await supabase.from('sections').insert({ school_id: school.id, name: 'S', display_order: 1 }).select('id').single()).data)
  const cls = need((await supabase.from('classes').insert({ school_id: school.id, section_id: section.id, name: 'C', display_order: 1, is_active: true }).select('id').single()).data)

  const dvaRef = `cascade-test-${Date.now()}`
  const student = need((await supabase.from('students').insert({
    school_id: school.id, section_id: section.id, class_id: cls.id,
    first_name: 'Cascade', last_name: 'Test', admission_number: `CT-${Date.now()}`,
    admission_date: new Date().toISOString().slice(0, 10), status: 'active',
    provider_dva_reference: dvaRef,
  }).select('id').single()).data)

  // Three terms: one closed (should be skipped entirely), two open in order.
  const closedCycle = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Closed Term', start_date: '2025-09-01', end_date: '2025-12-01', due_date: '2025-11-01', status: 'closed',
  }).select('id').single()).data)
  const cycleA = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term A (older, open)', start_date: '2026-01-01', end_date: '2026-04-01', due_date: '2026-03-01', status: 'active',
  }).select('id').single()).data)
  const cycleB = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term B (newer, open)', start_date: '2026-05-01', end_date: '2026-08-01', due_date: '2026-07-01', status: 'draft',
  }).select('id').single()).data)

  const closedInvoice = need((await supabase.from('invoices').insert({
    school_id: school.id, student_id: student.id, billing_cycle_id: closedCycle.id,
    total_amount: 5000, paid_amount: 0, status: 'pending', generated_at: new Date().toISOString(),
  }).select('id').single()).data)
  const invoiceA = need((await supabase.from('invoices').insert({
    school_id: school.id, student_id: student.id, billing_cycle_id: cycleA.id,
    total_amount: 3000, paid_amount: 0, status: 'pending', generated_at: new Date().toISOString(),
  }).select('id').single()).data)
  const invoiceB = need((await supabase.from('invoices').insert({
    school_id: school.id, student_id: student.id, billing_cycle_id: cycleB.id,
    total_amount: 4000, paid_amount: 0, status: 'pending', generated_at: new Date().toISOString(),
  }).select('id').single()).data)

  // Seed B's "already partially paid" state via a REAL payments row (an
  // earlier manual cash payment, unrelated to Monnify) so the trigger has
  // something genuine to sum — not a hand-set paid_amount with nothing
  // backing it.
  await supabase.from('payments').insert({
    school_id: school.id, student_id: student.id, invoice_id: invoiceB.id,
    amount: 1000, method: 'cash', match_status: 'matched', paid_at: new Date().toISOString(),
  })

  console.log('closed invoice (outstanding 5000, should stay untouched):', closedInvoice.id)
  console.log('invoice A (outstanding 3000):', invoiceA.id)
  console.log('invoice B (outstanding 3000, i.e. 4000 - 1000 real cash payment):', invoiceB.id)

  const url = `${BASE_URL}/api/webhooks/monnify/${school.id}`

  console.log('\n=== payment 1: amountPaid=5000 -> fully pay A (3000), partially pay B (2000 of 3000 outstanding) ===')
  const tx1 = `MNFY|CASCADE|${Date.now()}|000001`
  const r1 = await sendWebhook(url, makePayload(dvaRef, tx1, 5000))
  console.log('status:', r1.status, r1.body)

  console.log('\n=== payment 2: amountPaid=2500 -> fully pay remaining B (1000), overflow 1500 to credit_balance ===')
  const tx2 = `MNFY|CASCADE|${Date.now()}|000002`
  const r2 = await sendWebhook(url, makePayload(dvaRef, tx2, 2500))
  console.log('status:', r2.status, r2.body)

  console.log('\n=== duplicate redelivery of payment 2 (expect rejected, no double-apply) ===')
  const r2dup = await sendWebhook(url, makePayload(dvaRef, tx2, 2500))
  console.log('status:', r2dup.status, r2dup.body)

  console.log('\n=== verification ===')
  const { data: invoicesAfter } = await supabase
    .from('invoices')
    .select('id, total_amount, paid_amount, outstanding_amount, status')
    .in('id', [closedInvoice.id, invoiceA.id, invoiceB.id])
    .order('total_amount', { ascending: false })
  console.table(invoicesAfter)

  const closedAfter = invoicesAfter!.find(i => i.id === closedInvoice.id)
  const aAfter = invoicesAfter!.find(i => i.id === invoiceA.id)
  const bAfter = invoicesAfter!.find(i => i.id === invoiceB.id)

  const studentAfter = need((await supabase.from('students').select('credit_balance').eq('id', student.id).single()).data)

  const { data: paymentsAfter } = await supabase.from('payments').select('invoice_id, amount, provider_transaction_id').eq('student_id', student.id).order('created_at')
  console.table(paymentsAfter)

  const { data: claimsAfter } = await supabase.from('processed_provider_transactions').select('provider_transaction_id').eq('school_id', school.id)

  console.log('\n=== assertions ===')
  assertEqual('closed invoice untouched', closedAfter?.paid_amount, 0)
  assertEqual('invoice A fully paid', aAfter?.paid_amount, 3000)
  assertEqual('invoice A status', aAfter?.status, 'paid')
  assertEqual('invoice B fully paid', bAfter?.paid_amount, 4000)
  assertEqual('invoice B status', bAfter?.status, 'paid')
  assertEqual('student credit_balance', Number(studentAfter?.credit_balance), 1500)
  assertEqual('payments row count (not doubled by the duplicate)', paymentsAfter?.length, 5) // B's real cash seed + A + B(partial) + B(remainder) + credit-overflow
  assertEqual('processed_provider_transactions count (not doubled)', claimsAfter?.length, 2)
  assertEqual('duplicate response status', r2dup.status, 200)
  assertEqual('duplicate response message', r2dup.body.message, 'Duplicate delivery, already processed')

  console.log('\n=== cleanup ===')
  await supabase.from('payments').delete().eq('school_id', school.id)
  await supabase.from('processed_provider_transactions').delete().eq('school_id', school.id)
  await supabase.from('webhook_events').delete().eq('school_id', school.id)
  await supabase.from('invoices').delete().eq('school_id', school.id)
  await supabase.from('billing_cycles').delete().eq('school_id', school.id)
  await supabase.from('students').delete().eq('id', student.id)
  await supabase.from('classes').delete().eq('id', cls.id)
  await supabase.from('sections').delete().eq('id', section.id)
  await supabase.from('schools').delete().eq('id', school.id)
  console.log('cleaned up')

  if (process.exitCode === 1) {
    console.log('\nSOME ASSERTIONS FAILED — see PASS/FAIL lines above')
  } else {
    console.log('\nAll assertions passed.')
  }
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
