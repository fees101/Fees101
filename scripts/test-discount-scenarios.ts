// Manual end-to-end test for the discount system + the staleness fix.
// Throwaway school, self-cleaning. Not part of the app or CI.
//
//   npx tsx scripts/test-discount-scenarios.ts
//
// Covers:
//   1. Sibling discount auto-applies to the 2nd child (by admission date),
//      not the 1st, and is a % of the DISCOUNTABLE subtotal only (a
//      non-discountable exam fee is excluded from the % base).
//   2. The existingInvoiceId staleness fix: an invoice with a manual one-off
//      discount recomputes to its stored total ONLY when the invoice id is
//      passed; without it, the recompute omits the manual discount and would
//      falsely flag the invoice as "out of date" forever.

import { createServiceRoleClient } from '../src/lib/supabase/serviceRole'
import { computeInvoiceForStudent } from '../src/lib/computeInvoice'

const ADMIN_USER_ID = 'a5309369-4180-45d0-a164-ea3ac107d2d9' // real user, for discounts.requested_by

let failures = 0
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`)
  if (!ok) failures++
}
function need<T>(data: T | null): T {
  if (data === null) throw new Error('Expected a row back, got null')
  return data
}

async function main() {
  const supabase = createServiceRoleClient()

  console.log('=== setup ===')
  const school = need((await supabase.from('schools').insert({
    name: 'Discount Test School (delete me)',
    // Explicit sibling tiers: 2nd child 10%, 3rd+ 20%.
    settings: { discounts: { siblingTiers: [{ value: 10, isPercentage: true }, { value: 20, isPercentage: true }], staffDiscountDefaultPct: 50 } },
  }).select('id').single()).data)

  const section = need((await supabase.from('sections').insert({ school_id: school.id, name: 'S', display_order: 1 }).select('id').single()).data)
  const cls = need((await supabase.from('classes').insert({ school_id: school.id, section_id: section.id, name: 'C', display_order: 1, is_active: true }).select('id').single()).data)
  const family = need((await supabase.from('families').insert({ school_id: school.id, primary_parent_name: 'Test Parent', primary_parent_phone: '08000000000' }).select('id').single()).data)

  // Two siblings in one family — elder admitted earlier.
  const elder = need((await supabase.from('students').insert({
    school_id: school.id, section_id: section.id, class_id: cls.id, family_id: family.id,
    first_name: 'Elder', last_name: 'Child', admission_number: `EL-${Date.now()}`,
    admission_date: '2024-09-01', status: 'active',
  }).select('id').single()).data)
  const younger = need((await supabase.from('students').insert({
    school_id: school.id, section_id: section.id, class_id: cls.id, family_id: family.id,
    first_name: 'Younger', last_name: 'Child', admission_number: `YO-${Date.now()}`,
    admission_date: '2025-09-01', status: 'active',
  }).select('id').single()).data)

  const cycle = need((await supabase.from('billing_cycles').insert({
    school_id: school.id, name: 'Term 1', start_date: '2026-01-01', end_date: '2026-04-01', due_date: '2026-03-01', status: 'active',
  }).select('id').single()).data)

  // One discountable fee (tuition 100k) + one NON-discountable (exam 20k).
  await supabase.from('fee_items').insert([
    { school_id: school.id, billing_cycle_id: cycle.id, class_id: null, name: 'Tuition', amount: 100000, is_mandatory: true, is_optional_extra: false, is_discountable: true },
    { school_id: school.id, billing_cycle_id: cycle.id, class_id: null, name: 'Exam', amount: 20000, is_mandatory: true, is_optional_extra: false, is_discountable: false },
  ])

  // ============================================================
  console.log('\n=== SCENARIO 1: sibling discount, discountable-only base ===')
  // ============================================================
  const elderComputed = await computeInvoiceForStudent(supabase, school.id, elder.id, cycle.id)
  if ('error' in elderComputed) throw new Error(elderComputed.error)
  assertEqual('S1: eldest child gets NO discount', elderComputed.discountAmount, 0)
  assertEqual('S1: eldest total = full fees (100k + 20k)', elderComputed.total, 120000)

  const youngerComputed = await computeInvoiceForStudent(supabase, school.id, younger.id, cycle.id)
  if ('error' in youngerComputed) throw new Error(youngerComputed.error)
  // 10% of the DISCOUNTABLE subtotal (100k tuition only) = 10k. Exam excluded.
  assertEqual('S1: 2nd child sibling discount = 10% of tuition only (not exam)', youngerComputed.discountAmount, 10000)
  assertEqual('S1: 2nd child total = 120k - 10k', youngerComputed.total, 110000)

  // ============================================================
  console.log('\n=== SCENARIO 2: manual one-off discount survives staleness recompute (the fix) ===')
  // ============================================================
  // Persist the younger child's invoice as generated (total 110k, sibling discount already in it).
  const invoice = need((await supabase.from('invoices').insert({
    school_id: school.id, student_id: younger.id, billing_cycle_id: cycle.id,
    invoice_number: `TEST-${Date.now()}`, total_amount: 110000, paid_amount: 0,
    subtotal: 120000, previous_balance: 0, discount_amount: 10000, credit_applied: 0,
    status: 'pending', generated_at: new Date().toISOString(),
  }).select('id').single()).data)

  // A bursar approves a manual ₦5,000 hardship discount directly on this invoice.
  await supabase.from('discounts').insert({
    school_id: school.id, invoice_id: invoice.id, student_id: younger.id,
    amount: 5000, is_percentage: false, is_recurring: false, category: 'financial_hardship',
    reason: 'Manual hardship discount', status: 'applied',
    requested_by: ADMIN_USER_ID, requested_at: new Date().toISOString(), applied_at: new Date().toISOString(),
  })
  // The real generate flow would now store total = 120k - (10k sibling + 5k manual) = 105k.
  await supabase.from('invoices').update({ total_amount: 105000, discount_amount: 15000 }).eq('id', invoice.id)

  // WITHOUT existingInvoiceId: manual discount is invisible → recompute = 110k → would falsely flag stale.
  const withoutId = await computeInvoiceForStudent(supabase, school.id, younger.id, cycle.id)
  if ('error' in withoutId) throw new Error(withoutId.error)
  assertEqual('S2: WITHOUT invoice id, recompute omits the manual discount (would false-flag stale)', withoutId.total, 110000)

  // WITH existingInvoiceId: manual discount folded in → recompute = 105k = stored → NOT stale.
  const withId = await computeInvoiceForStudent(supabase, school.id, younger.id, cycle.id, undefined, 0, invoice.id)
  if ('error' in withId) throw new Error(withId.error)
  assertEqual('S2: WITH invoice id, recompute includes manual discount, matches stored 105k', withId.total, 105000)
  assertEqual('S2: WITH invoice id, discountAmount = sibling 10k + manual 5k', withId.discountAmount, 15000)

  console.log('\n=== cleanup ===')
  await supabase.from('discounts').delete().eq('school_id', school.id)
  await supabase.from('invoices').delete().eq('school_id', school.id)
  await supabase.from('fee_items').delete().eq('school_id', school.id)
  await supabase.from('billing_cycles').delete().eq('school_id', school.id)
  await supabase.from('students').delete().eq('school_id', school.id)
  await supabase.from('families').delete().eq('school_id', school.id)
  await supabase.from('classes').delete().eq('id', cls.id)
  await supabase.from('sections').delete().eq('id', section.id)
  await supabase.from('schools').delete().eq('id', school.id)
  console.log('cleaned up')

  if (failures > 0) {
    console.log(`\n${failures} ASSERTION(S) FAILED`)
    process.exitCode = 1
  } else {
    console.log('\nAll assertions passed.')
  }
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
