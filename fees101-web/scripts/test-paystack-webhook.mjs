// Synthetic Paystack webhook test — no real transfer needed. Signs payloads
// with the school's real secret (HMAC-SHA512 hex) and fires them at the live
// local endpoint, exercising every branch of the handler.
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL, K=env.SUPABASE_SERVICE_ROLE_KEY
const SECRET=env.PAYSTACK_TEST_SECRET_KEY
const H={apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'}
const g=p=>fetch(`${U}/rest/v1/${p}`,{headers:H}).then(r=>r.json())
const patch=(p,b)=>fetch(`${U}/rest/v1/${p}`,{method:'PATCH',headers:H,body:JSON.stringify(b)})
const del=p=>fetch(`${U}/rest/v1/${p}`,{method:'DELETE',headers:H})

const SCHOOL='d80be88f-c95b-4205-9698-75f806343d84'
const STUDENT='c3cb9958-d32a-4ff6-b18d-93f462d03611'
const CUS='CUS_wtc8alit8mxwsi0'
const HOOK=`http://localhost:3000/api/webhooks/paystack/${SCHOOL}`
const sign=body=>crypto.createHmac('sha512',SECRET).update(body).digest('hex')

async function post(rawBody, signature){
  const res=await fetch(HOOK,{method:'POST',headers:{'content-type':'application/json','x-paystack-signature':signature},body:rawBody})
  const text=await res.text(); let j; try{j=JSON.parse(text)}catch{j=text}
  return {status:res.status, body:j}
}
async function state(label){
  const inv=(await g(`invoices?student_id=eq.${STUDENT}&select=paid_amount,status`))[0]
  const pays=await g(`payments?student_id=eq.${STUDENT}&select=amount,provider,method,provider_reference&order=paid_at.desc`)
  const stu=(await g(`students?id=eq.${STUDENT}&select=credit_balance`))[0]
  console.log(`  [${label}] invoice: ${inv.status} paid=${inv.paid_amount} | payments=${pays.length} | credit=${stu.credit_balance}`)
  return {inv,pays,stu}
}

// --- Reset to a clean unpaid invoice so the webhook is the canonical proof ---
console.log('RESET: clearing prior simulated payment, invoice -> pending')
await del(`payments?student_id=eq.${STUDENT}`)
await del(`processed_provider_transactions?school_id=eq.${SCHOOL}`)
await patch(`invoices?student_id=eq.${STUDENT}`, {paid_amount:0, status:'pending'})
await patch(`students?id=eq.${STUDENT}`, {credit_balance:0})
await state('after reset')

const REF='test-wh-001'
const payload = JSON.stringify({
  event:'charge.success',
  data:{ reference:REF, amount:5000000, fees:50000, status:'success',
    paid_at:'2026-08-28T12:00:00.000Z', customer:{ customer_code:CUS } },
})

console.log('\nTEST 1 — valid signature, charge.success (expect 200, invoice paid)')
let r=await post(payload, sign(payload)); console.log('  ->', r.status, JSON.stringify(r.body))
await state('after valid')

console.log('\nTEST 2 — tampered signature (expect 401, no change)')
r=await post(payload, sign(payload)+'00'); console.log('  ->', r.status, JSON.stringify(r.body))

console.log('\nTEST 3 — duplicate delivery, same reference (expect 200 duplicate, still 1 payment)')
r=await post(payload, sign(payload)); console.log('  ->', r.status, JSON.stringify(r.body))
await state('after duplicate')

console.log('\nTEST 4 — non-charge event transfer.success (expect 200 acknowledged, ignored)')
const other=JSON.stringify({event:'transfer.success',data:{reference:'tr-1',amount:100,customer:{customer_code:CUS}}})
r=await post(other, sign(other)); console.log('  ->', r.status, JSON.stringify(r.body))

console.log('\nTEST 5 — unknown customer code (expect 200, no matching student)')
const unknown=JSON.stringify({event:'charge.success',data:{reference:'test-wh-002',amount:100000,fees:0,status:'success',paid_at:'2026-08-28T12:00:00.000Z',customer:{customer_code:'CUS_doesnotexist'}}})
r=await post(unknown, sign(unknown)); console.log('  ->', r.status, JSON.stringify(r.body))
await state('final')

console.log('\n=== webhook_events audit trail (this run) ===')
const evs=await g(`webhook_events?school_id=eq.${SCHOOL}&provider=eq.paystack&select=event_type,status,transaction_reference,error_message&order=created_at.desc&limit=6`)
for(const e of evs) console.log(`  ${e.status.padEnd(18)} ${e.event_type||'-'}  ref=${e.transaction_reference||'-'} ${e.error_message?'('+e.error_message+')':''}`)
