// Synthetic Paystack TERMINAL webhook test — no real device needed. Mirrors
// scripts/test-paystack-webhook.mjs (the DVA one) but exercises the in-person
// card rail: it seeds a terminal_payment_requests row, then fires signed
// charge.success payloads carrying that charge's references and asserts the
// payment is applied with method='provider_terminal', the terminal row flips to
// 'paid', and the invoice updates — exactly as a real device round-trip would.
//
// PREREQ: run db/pos_terminal.sql in Supabase first (creates the two tables).
// Run against the seeded test school (same IDs as the DVA test).
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL, K=env.SUPABASE_SERVICE_ROLE_KEY
const SECRET=env.PAYSTACK_TEST_SECRET_KEY
const H={apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'}
const g=p=>fetch(`${U}/rest/v1/${p}`,{headers:H}).then(r=>r.json())
const post_=(p,b)=>fetch(`${U}/rest/v1/${p}`,{method:'POST',headers:{...H,Prefer:'return=representation'},body:JSON.stringify(b)}).then(r=>r.json())
const patch=(p,b)=>fetch(`${U}/rest/v1/${p}`,{method:'PATCH',headers:H,body:JSON.stringify(b)})
const del=p=>fetch(`${U}/rest/v1/${p}`,{method:'DELETE',headers:H})

const SCHOOL='d80be88f-c95b-4205-9698-75f806343d84'
const HOOK=`http://localhost:3000/api/webhooks/paystack/${SCHOOL}`
const sign=body=>crypto.createHmac('sha512',SECRET).update(body).digest('hex')

// Auto-discover a student in the test school with an open invoice to anchor the
// test on (the hardcoded DVA-test student may have no current invoice).
const openInv=(await g(`invoices?school_id=eq.${SCHOOL}&outstanding_amount=gt.0&status=neq.cancelled&select=id,student_id,outstanding_amount&order=outstanding_amount.desc&limit=1`))[0]
if(!openInv){console.error('No open invoice in the test school — generate one first.');process.exit(1)}
const STUDENT=openInv.student_id
const stuRow=(await g(`students?id=eq.${STUDENT}&select=first_name,last_name,provider_dva_reference`))[0]
const CUS=stuRow?.provider_dva_reference||null
console.log(`Anchor: ${stuRow?.first_name} ${stuRow?.last_name} (student ${STUDENT.slice(0,8)}), invoice ${openInv.id.slice(0,8)}, outstanding ${openInv.outstanding_amount}, customer ${CUS||'none'}`)

async function post(rawBody){
  const res=await fetch(HOOK,{method:'POST',headers:{'content-type':'application/json','x-paystack-signature':sign(rawBody)},body:rawBody})
  const text=await res.text(); let j; try{j=JSON.parse(text)}catch{j=text}
  return {status:res.status, body:j}
}
async function state(label){
  const inv=(await g(`invoices?student_id=eq.${STUDENT}&select=id,paid_amount,status,outstanding_amount`))[0]
  const pays=await g(`payments?student_id=eq.${STUDENT}&select=amount,provider,method,provider_reference&order=paid_at.desc`)
  const reqs=await g(`terminal_payment_requests?student_id=eq.${STUDENT}&select=reference,status,applied_payment_ids&order=created_at.desc`)
  console.log(`  [${label}] invoice: ${inv?.status} paid=${inv?.paid_amount} | payments=${pays.length}${pays[0]?' ('+pays[0].method+')':''} | terminal rows: ${reqs.map(r=>r.status).join(',')||'none'}`)
  return {inv,pays,reqs}
}

// --- Clean slate ---
console.log('RESET: clearing prior payments + terminal requests, invoice -> pending')
await del(`payments?student_id=eq.${STUDENT}`)
await del(`processed_provider_transactions?school_id=eq.${SCHOOL}`)
await del(`terminal_payment_requests?school_id=eq.${SCHOOL}`)
await patch(`invoices?student_id=eq.${STUDENT}`, {paid_amount:0, status:'pending'})
await patch(`students?id=eq.${STUDENT}`, {credit_balance:0})
const {inv}=await state('after reset')
if(!inv){console.error('No invoice for the test student — seed one first.');process.exit(1)}

// Seed a terminal charge the bursar "pushed" (status 'sent', awaiting payment).
const OFF='OFF-term-001'
await post_('terminal_payment_requests', {
  school_id:SCHOOL, student_id:STUDENT, invoice_id:inv.id, terminal_id:'TID_test_001',
  reference:'TERM-test-001', paystack_payment_request_id:'PRQ_test_001', request_code:'PRQ_test_001',
  offline_reference:OFF, amount:Math.max(1, inv.outstanding_amount||50000), status:'sent',
})
await state('after push (seeded)')

// TEST 1 — charge.success as Paystack really sends it: the pushed reference (our
// offline_reference) is in data.reference, and our key rides in data.metadata.
// No customer_code — proves the terminal rail resolves on its own identifiers.
console.log('\nTEST 1 — terminal charge.success (data.reference = offline_reference + metadata), no customer_code (expect paid, provider_terminal)')
let p1=JSON.stringify({event:'charge.success',data:{reference:OFF,metadata:{fees101_reference:'TERM-test-001'},amount:(inv.outstanding_amount||50000)*100,fees:25000,status:'success',paid_at:'2026-09-01T10:00:00.000Z',channel:'pos'}})
let r=await post(p1); console.log('  ->',r.status,JSON.stringify(r.body))
await state('after terminal charge')

// TEST 2 — duplicate delivery of the same transaction (expect duplicate, no double-apply)
console.log('\nTEST 2 — duplicate delivery same reference (expect 200 duplicate, still 1 payment)')
r=await post(p1); console.log('  ->',r.status,JSON.stringify(r.body))
await state('after duplicate')

// TEST 3 — a failed terminal event on a fresh pushed row marks it 'failed' (no money)
console.log('\nTEST 3 — paymentrequest.failed on a new pushed row (expect row -> failed, no payment)')
await post_('terminal_payment_requests', {school_id:SCHOOL,student_id:STUDENT,invoice_id:inv.id,terminal_id:'TID_test_001',reference:'TERM-test-002',offline_reference:'OFF-term-002',amount:10000,status:'sent'})
const pf=JSON.stringify({event:'paymentrequest.failed',data:{offline_reference:'OFF-term-002'}})
r=await post(pf); console.log('  ->',r.status,JSON.stringify(r.body))
await state('after failed event')

console.log('\n=== webhook_events audit trail (this run) ===')
const evs=await g(`webhook_events?school_id=eq.${SCHOOL}&provider=eq.paystack&select=event_type,status,transaction_reference,error_message&order=created_at.desc&limit=6`)
for(const e of evs) console.log(`  ${(e.status||'').padEnd(18)} ${e.event_type||'-'}  ref=${e.transaction_reference||'-'} ${e.error_message?'('+e.error_message+')':''}`)

console.log('\nExpected: TEST1 payment applied as provider_terminal + terminal row "paid"; TEST2 duplicate; TEST3 second row "failed".')
console.log('Then view the student in the browser — the payment should read "Card terminal (in person)" on the timeline, invoice detail, and receipt PDF.')
