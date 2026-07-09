// Manual end-to-end test for payment TIMING scenarios — not part of the app
// or CI. Exercises the real webhook endpoint against a throwaway school,
// then mirrors the exact insert/update logic used by the real "generate
// invoice" / "close term" server actions (those are 'use server' functions
// gated on a cookie session via getContext(), so they can't be imported
// directly into a script — this calls the same underlying shared functions
// they call, computeInvoiceForStudent + applyCreditBalanceDelta, and
// performs the identical persistence steps by hand).
//
// No real Monnify credentials are needed: verifyWebhookSignature() is a
// pure local HMAC-SHA512 comparison against the school's stored secret key,
// with no network call to Monnify, and the test student's DVA reference is
// synthetic (never created via a real Monnify createDVA call) — same as
// scripts/test-payment-cascade.ts. Any consistent dummy secret works.
//
// Usage:
//   npx tsx scripts/test-payment-timing-scenarios.ts
// (requires the dev server running on localhost:3000)
//
// Covers:
//   1. Payment arrives BEFORE any invoice exists for the term — parks in
//      credit_balance, then is correctly absorbed when the invoice is later
//      generated.
//   2. Payment arrives AFTER a term closes, before the next term's invoice
//      exists — parks in credit_balance (the closed invoice stays frozen),
//      then is correctly split across the carried-forward previous balance
//      when the next invoice is generated.
//   3. Regression test for the exact bug reported against Zainab Musa's real
//      data: an invoice fully paid by a direct transfer, with leftover
//      credit sitting on the student from the same overpayment, must NOT
//      have that credit re-applied against it on a later regenerate. Before
//      the fix, this produced a negative outstanding_amount and silently
//      spent real credit for nothing.
//   4. Withdrawn student — a real, reachable status change (updateStudentStatus)
//      that has no side effects on invoices/DVA/credit_balance. Confirms money
//      arriving after withdrawal still applies to any open invoice normally,
//      and safely parks on credit_balance (never lost) once there's nothing
//      open left to apply to.

import { createServiceRoleClient } from '../src/lib/supabase/serviceRole'
import { encryptCredential } from '../src/lib/payments/encryption'
import { computeInvoiceForStudent, applyCreditBalanceDelta } from '../src/lib/computeInvoice'
import crypto from 'crypto'

const SECRET_KEY = 'test-secret-key-timing-scenarios'
const BASE_URL = 'http://localhost:3000'

function makePayload(dvaRef: string, transactionReference: string, amountPaid: number, paidOn: string) {
  return {
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: {
      product: { reference: dvaRef, type: 'RESERVED_ACCOUNT' },
      transactionReference,
      paymentReference: transactionReference,
      paidOn,
      paymentDescription: 'Timing scenario test',
      metaData: {},
      paymentSourceInformation: [{ bankCode: '057', amountPaid, accountName: 'Timing Test Payer', sessionId: 'sim', accountNumber: '0000000000' }],
      destinationAccountInformation: { bankCode: '035', bankName: 'Wema bank', accountNumber: '1234567890' },
      amountPaid,
      totalPayable: amountPaid,
      cardDetails: {},
      paymentMethod: 'ACCOUNT_TRANSFER',
      currency: 'NGN',
      settlementAmount: String(amountPaid - 10),
      paymentStatus: 'PAID',
      paymentScope: 'LOCAL',
      customer: { name: 'Timing Test Payer', email: 'timing@example.com' },
    },
  }
}

async function sendWebhook(url: string, payload: any) {
  const rawBody = JSON.stringify(payload)
  const signature = crypto.createHmac('sha512', SECRET_KEY).update(rawBody).digest('hex')
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'monnify-signature': signature }, body: rawBody })
  return { status: res.status, body: await res.json() }
}

let failures = 0
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`)
  if (!ok) failures++
}

function need<T>(data: T | null): T {
  if (data === null) throw new Error('Expected a row back from Supabase, got null')
  return data
}

// Mirrors generateInvoiceForStudent's insert, minus invoice numbering (not
// under test here) and the auth-gated context.
async function generateInvoice(supabase: any, schoolId: string, studentId: string, cycleId: string) {
  const computed = await computeInvoiceForStudent(supabase, schoolId, studentId, cycleId)
  if ('error' in computed) throw new Error(`computeInvoiceForStudent failed: ${computed.error}`)

  const status: 'pending' | 'paid' = computed.total === 0 ? 'paid' : 'pending'
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      billing_cycle_id: cycleId,
      invoice_number: `TEST-${Date.now()}`,
      line_items: computed.lineItems,
      subtotal: computed.subtotal,
      discount_amount: 0,
      previous_balance: computed.previousBalance,
      credit_applied: computed.creditApplied,
      total_amount: computed.total,
      paid_amount: 0,
      status,
      sent_at: null,
      needs_resend: false,
      generated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(`invoice insert failed: ${error.message}`)

  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, studentId, -computed.creditApplied)
  }
  return { invoiceId: data.id, computed }
}

// Mirrors regenerateInvoice's update for an existing invoice.
async function regenerateInvoice(supabase: any, schoolId: string, studentId: string, cycleId: string, invoiceId: string) {
  const { data: existing } = await supabase
    .from('invoices')
    .select('paid_amount, credit_applied')
    .eq('id', invoiceId)
    .single()

  const previouslyApplied = Number(existing.credit_applied || 0)
  if (previouslyApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, studentId, previouslyApplied)
  }

  const paid = Number(existing.paid_amount || 0)
  const computed = await computeInvoiceForStudent(supabase, schoolId, studentId, cycleId, undefined, paid)
  if ('error' in computed) throw new Error(`computeInvoiceForStudent failed: ${computed.error}`)

  let newStatus: 'pending' | 'partial' | 'paid' = 'pending'
  if (paid >= computed.total) newStatus = 'paid'
  else if (paid > 0) newStatus = 'partial'

  await supabase
    .from('invoices')
    .update({
      line_items: computed.lineItems,
      subtotal: computed.subtotal,
      previous_balance: computed.previousBalance,
      credit_applied: computed.creditApplied,
      total_amount: computed.total,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  if (computed.creditApplied > 0) {
    await applyCreditBalanceDelta(supabase, schoolId, studentId, -computed.creditApplied)
  }
  return computed
}

async function main() {
  const supabase = createServiceRoleClient()

  console.log('=== setup ===')
  const school = need((await supabase.from('schools').insert({
    name: 'Timing Scenarios Test School (delete me)',
    payment_provider: 'monnify',
    provider_api_key: encryptCredential('dummy-unused-api-key'),
    provider_secret_key: encryptCredential(SECRET_KEY),
    provider_contract_code: 'dummy-unused-contract-code',
  }).select('id').single()).data)

  const section = need((await supabase.from('sections').insert({ school_id: school.id, name: 'S', display_order: 1 }).select('id').single()).data)
  const cls = need((await supabase.from('classes').insert({ school_id: school.id, section_id: section.id, name: 'C', display_order: 1, is_active: true }).select('id').single()).data)

  const dvaRef = `timing-test-${Date.now()}`
  const student = need((await supabase.from('students').insert({
    school_id: school.id, section_id: section.id, class_id: cls.id,
    first_name: 'Timing', last_name: 'Test', admission_number: `TT-${Date.now()}`,
    admission_date: new Date().toISOString().slice(0, 10), status: 'active',
    provider_dva_reference: dvaRef,
  }).select('id').single()).data)

  // Separate student for scenario 3, so its cascade isn't affected by
  // scenario 1/2's still-open invoices on the shared student — this test
  // is specifically about the credit-vs-already-paid interaction, not
  // cascade ordering (which scenario 1/2, and the earlier Slice 3 test,
  // already cover).
  const dvaRefB = `timing-test-b-${Date.now()}`
  const studentB = need((await supabase.from('students').insert({
    school_id: school.id, section_id: section.id, class_id: cls.id,
    first_name: 'Timing', last_name: 'TestB', admission_number: `TTB-${Date.now()}`,
    admission_date: new Date().toISOString().slice(0, 10), status: 'active',
    provider_dva_reference: dvaRefB,
  }).select('id').single()).data)

  const url = `${BASE_URL}/api/webhooks/monnify/${school.id}`

  // ============================================================
  console.log('\n=== SCENARIO 1: payment before any invoice exists ===')
  // ============================================================
  const cycle1 = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term 1', start_date: '2026-01-01', end_date: '2026-04-01', due_date: '2026-03-01', status: 'active',
  }).select('id').single()).data)

  await supabase.from('fee_items').insert({
    school_id: school.id, billing_cycle_id: cycle1.id, class_id: null,
    name: 'Tuition', amount: 126000, is_mandatory: true, is_optional_extra: false,
  })

  const tx1 = `MNFY|TIMING|${Date.now()}|000001`
  const r1 = await sendWebhook(url, makePayload(dvaRef, tx1, 50000, '2026-01-15 10:00:00.000000000'))
  console.log('webhook status:', r1.status, r1.body)

  const studentAfterEarlyPay = need((await supabase.from('students').select('credit_balance').eq('id', student.id).single()).data)
  assertEqual('S1: money parks in credit_balance (no invoice existed yet)', Number(studentAfterEarlyPay.credit_balance), 50000)

  const { data: paymentsS1 } = await supabase.from('payments').select('invoice_id, amount').eq('student_id', student.id)
  assertEqual('S1: payment row has no invoice_id (nothing to attach to yet)', paymentsS1?.[0]?.invoice_id, null)

  const { invoiceId: invoice1Id, computed: computed1 } = await generateInvoice(supabase, school.id, student.id, cycle1.id)
  assertEqual('S1: invoice absorbs the waiting credit as credit_applied', computed1.creditApplied, 50000)
  assertEqual('S1: invoice total is fee minus the credit already received', computed1.total, 76000)

  const invoice1 = need((await supabase.from('invoices').select('total_amount, outstanding_amount, credit_applied').eq('id', invoice1Id).single()).data)
  assertEqual('S1: outstanding_amount matches (nothing paid directly on the invoice itself)', Number(invoice1.outstanding_amount), 76000)

  const studentAfterGen1 = need((await supabase.from('students').select('credit_balance').eq('id', student.id).single()).data)
  assertEqual('S1: credit_balance spent down to 0 after being applied', Number(studentAfterGen1.credit_balance), 0)

  // ============================================================
  console.log('\n=== SCENARIO 2: payment after term closes, before next invoice exists ===')
  // ============================================================
  // Close term 1 with invoice1 still owing 76000 (mirrors closeTermAndCarryForward's cycle-status update).
  await supabase.from('billing_cycles').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', cycle1.id)

  const cycle2 = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term 2', start_date: '2026-05-01', end_date: '2026-08-01', due_date: '2026-07-01', status: 'active',
  }).select('id').single()).data)
  // No fee_items or invoice for cycle2 yet at this point — the late payment must have nothing open to land on.

  const tx2 = `MNFY|TIMING|${Date.now()}|000002`
  const r2 = await sendWebhook(url, makePayload(dvaRef, tx2, 80000, '2026-05-10 10:00:00.000000000'))
  console.log('webhook status:', r2.status, r2.body)

  const invoice1AfterClose = need((await supabase.from('invoices').select('paid_amount, outstanding_amount').eq('id', invoice1Id).single()).data)
  assertEqual('S2: closed invoice stays frozen, untouched by the late payment', Number(invoice1AfterClose.paid_amount), 0)
  assertEqual('S2: closed invoice still shows its original 76000 owed', Number(invoice1AfterClose.outstanding_amount), 76000)

  const studentAfterLatePay = need((await supabase.from('students').select('credit_balance').eq('id', student.id).single()).data)
  assertEqual('S2: late payment parks in credit_balance (no open invoice to apply to)', Number(studentAfterLatePay.credit_balance), 80000)

  await supabase.from('fee_items').insert({
    school_id: school.id, billing_cycle_id: cycle2.id, class_id: null,
    name: 'Tuition', amount: 100000, is_mandatory: true, is_optional_extra: false,
  })

  const { invoiceId: invoice2Id, computed: computed2 } = await generateInvoice(supabase, school.id, student.id, cycle2.id)
  assertEqual('S2: next invoice carries forward the closed term\'s 76000', computed2.previousBalance, 76000)
  assertEqual('S2: waiting credit (80000) applies against the combined 176000 due', computed2.creditApplied, 80000)
  assertEqual('S2: remaining total is just this term\'s own fee (100000 - (80000 credit - 76000 carried) = 96000)', computed2.total, 96000)

  const studentAfterGen2 = need((await supabase.from('students').select('credit_balance').eq('id', student.id).single()).data)
  assertEqual('S2: credit_balance spent down to 0', Number(studentAfterGen2.credit_balance), 0)

  // ============================================================
  console.log('\n=== SCENARIO 3: regression — fully-paid invoice must survive a later regenerate ===')
  // ============================================================
  const cycle3 = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term 3', start_date: '2026-09-01', end_date: '2026-12-01', due_date: '2026-11-01', status: 'active',
  }).select('id').single()).data)

  await supabase.from('fee_items').insert({
    school_id: school.id, billing_cycle_id: cycle3.id, class_id: null,
    name: 'Tuition', amount: 126000, is_mandatory: true, is_optional_extra: false,
  })

  const { invoiceId: invoice3Id, computed: computed3 } = await generateInvoice(supabase, school.id, studentB.id, cycle3.id)
  assertEqual('S3: fresh invoice has no credit applied (none available yet)', computed3.creditApplied, 0)
  assertEqual('S3: fresh invoice total is the full fee', computed3.total, 126000)

  // One transfer that exactly covers this invoice plus a 47000 overpayment —
  // same shape as the real Zainab Musa transaction (invoice 126000, transfer
  // ~larger, remainder to credit).
  const tx3 = `MNFY|TIMING|${Date.now()}|000003`
  const r3 = await sendWebhook(url, makePayload(dvaRefB, tx3, 173000, '2026-09-10 10:00:00.000000000'))
  console.log('webhook status:', r3.status, r3.body)

  const invoice3AfterPay = need((await supabase.from('invoices').select('paid_amount, total_amount, status').eq('id', invoice3Id).single()).data)
  assertEqual('S3: invoice fully paid directly', Number(invoice3AfterPay.paid_amount), 126000)
  assertEqual('S3: invoice status paid', invoice3AfterPay.status, 'paid')

  const studentAfterOverpay = need((await supabase.from('students').select('credit_balance').eq('id', studentB.id).single()).data)
  assertEqual('S3: the 47000 overpayment sits on credit_balance', Number(studentAfterOverpay.credit_balance), 47000)

  // Now regenerate the ALREADY FULLY PAID invoice, with 47000 of credit
  // sitting right there and available. Before the alreadyPaidAmount fix,
  // this incorrectly applied min(availableCredit, amountDue) = 47000 of
  // credit against a bill that was already settled, producing
  // total_amount 79000 < paid_amount 126000 (a negative outstanding_amount)
  // and silently spending real credit for nothing.
  const computed3b = await regenerateInvoice(supabase, school.id, studentB.id, cycle3.id, invoice3Id)
  assertEqual('S3: regenerate must NOT re-apply the sitting credit', computed3b.creditApplied, 0)
  assertEqual('S3: total_amount stays equal to what was already paid', computed3b.total, 126000)

  const invoice3AfterRegen = need((await supabase.from('invoices').select('total_amount, paid_amount, outstanding_amount').eq('id', invoice3Id).single()).data)
  assertEqual('S3: outstanding_amount is 0, not negative', Number(invoice3AfterRegen.outstanding_amount), 0)

  const studentAfterRegen = need((await supabase.from('students').select('credit_balance').eq('id', studentB.id).single()).data)
  assertEqual('S3: the 47000 credit is untouched, still available for a future term', Number(studentAfterRegen.credit_balance), 47000)

  // ============================================================
  console.log('\n=== SCENARIO 4: withdrawn student — money must never be lost ===')
  // ============================================================
  // Real, reachable action: updateStudentStatus() only flips students.status.
  // It has no side effects on invoices, DVA, or credit_balance — so a
  // withdrawn student can still have an open invoice and a live DVA
  // reference. Money arriving after withdrawal must still land somewhere,
  // never silently vanish.
  const cycle4 = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term 4', start_date: '2027-01-01', end_date: '2027-04-01', due_date: '2027-03-01', status: 'active',
  }).select('id').single()).data)
  await supabase.from('fee_items').insert({
    school_id: school.id, billing_cycle_id: cycle4.id, class_id: null,
    name: 'Tuition', amount: 100000, is_mandatory: true, is_optional_extra: false,
  })
  // studentB still has the 47000 credit left sitting from scenario 3 — the
  // generate step absorbs it immediately (same mechanic scenarios 1/2
  // already proved), so invoice4's real total is 100000 - 47000 = 53000,
  // not the raw 100000 fee.
  const { invoiceId: invoice4Id, computed: computed4 } = await generateInvoice(supabase, school.id, studentB.id, cycle4.id)
  assertEqual('S4 setup: invoice4 absorbs studentB\'s sitting 47000 credit at generation', computed4.creditApplied, 47000)
  assertEqual('S4 setup: invoice4 total after absorbing that credit', computed4.total, 53000)

  const studentBeforeWithdrawnPay = need((await supabase.from('students').select('credit_balance').eq('id', studentB.id).single()).data)
  assertEqual('S4 setup: credit_balance spent down to 0 by generation', Number(studentBeforeWithdrawnPay.credit_balance), 0)

  // Withdraw the student — invoice4 stays open and unpaid.
  await supabase.from('students').update({ status: 'withdrawn' }).eq('id', studentB.id)

  const tx4 = `MNFY|TIMING|${Date.now()}|000004`
  const r4 = await sendWebhook(url, makePayload(dvaRefB, tx4, 130000, '2027-01-10 10:00:00.000000000'))
  console.log('webhook status (payment to open invoice, post-withdrawal):', r4.status, r4.body)

  const invoice4AfterPay = need((await supabase.from('invoices').select('paid_amount, status').eq('id', invoice4Id).single()).data)
  assertEqual('S4: withdrawn student\'s open invoice still gets paid normally', Number(invoice4AfterPay.paid_amount), 53000)
  assertEqual('S4: invoice status paid', invoice4AfterPay.status, 'paid')

  const studentAfterWithdrawnPay = need((await supabase.from('students').select('credit_balance, status').eq('id', studentB.id).single()).data)
  assertEqual('S4: overflow (130000 - 53000 = 77000) still lands in credit_balance, not lost', Number(studentAfterWithdrawnPay.credit_balance), 77000)
  assertEqual('S4: student status untouched by payment processing', studentAfterWithdrawnPay.status, 'withdrawn')

  // A second, later payment with NO open invoice left at all (fully paid,
  // withdrawn, no future invoice will ever be generated since
  // computeInvoiceForStudent blocks non-active students) — confirms money
  // still parks safely on credit_balance rather than erroring or vanishing.
  // This credit has no automatic path back to the family (no next invoice
  // will ever consume it for a withdrawn student) — that's a real gap, but
  // the existing `refunds` table implies this is an intentionally manual
  // process, not an automated one. Flagged in the report, not "fixed" here.
  const tx4b = `MNFY|TIMING|${Date.now()}|000005`
  const r4b = await sendWebhook(url, makePayload(dvaRefB, tx4b, 15000, '2027-01-11 10:00:00.000000000'))
  console.log('webhook status (payment with zero open invoices, post-withdrawal):', r4b.status, r4b.body)

  const studentAfterSecondWithdrawnPay = need((await supabase.from('students').select('credit_balance').eq('id', studentB.id).single()).data)
  assertEqual('S4: second payment also safely parks on credit_balance, nothing lost', Number(studentAfterSecondWithdrawnPay.credit_balance), 77000 + 15000)

  console.log('\n=== cleanup ===')
  await supabase.from('payments').delete().eq('school_id', school.id)
  await supabase.from('processed_provider_transactions').delete().eq('school_id', school.id)
  await supabase.from('webhook_events').delete().eq('school_id', school.id)
  await supabase.from('fee_items').delete().eq('school_id', school.id)
  await supabase.from('invoices').delete().eq('school_id', school.id)
  await supabase.from('billing_cycles').delete().eq('school_id', school.id)
  await supabase.from('students').delete().eq('id', student.id)
  await supabase.from('students').delete().eq('id', studentB.id)
  await supabase.from('classes').delete().eq('id', cls.id)
  await supabase.from('sections').delete().eq('id', section.id)
  await supabase.from('schools').delete().eq('id', school.id)
  console.log('cleaned up')

  if (failures > 0) {
    console.log(`\n${failures} ASSERTION(S) FAILED — see PASS/FAIL lines above`)
    process.exitCode = 1
  } else {
    console.log('\nAll assertions passed.')
  }
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
