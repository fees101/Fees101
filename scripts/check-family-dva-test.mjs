// Read-only check: did the family DVA test transfer land anywhere — webhook,
// payments, invoices, credit balance, or family overflow marker?
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL, K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'}
const g=p=>fetch(`${U}/rest/v1/${p}`,{headers:H}).then(r=>r.json())

const SCHOOL='d80be88f-c95b-4205-9698-75f806343d84'
const FAMILY='138cf0bb-1746-41b2-ac4c-476a69f9da9f'

console.log('=== webhook_events (paystack, this school, last 10) ===')
const evs = await g(`webhook_events?school_id=eq.${SCHOOL}&provider=eq.paystack&select=created_at,event_type,status,transaction_reference,error_message&order=created_at.desc&limit=10`)
if (!evs.length) console.log('  (none — no request has reached the app at all)')
for (const e of evs) console.log(`  ${e.created_at}  ${e.status.padEnd(18)} ${e.event_type||'-'}  ref=${e.transaction_reference||'-'} ${e.error_message?'('+e.error_message+')':''}`)

console.log('\n=== processed_provider_transactions (this school, last 10) ===')
const claimed = await g(`processed_provider_transactions?school_id=eq.${SCHOOL}&select=provider,provider_transaction_id,created_at&order=created_at.desc&limit=10`)
if (!claimed.length) console.log('  (none — nothing has ever been claimed/applied for this school)')
for (const c of claimed) console.log(`  ${c.created_at}  ${c.provider}  ${c.provider_transaction_id}`)

console.log('\n=== family ===')
const fam = (await g(`families?id=eq.${FAMILY}&select=id,provider_dva_account_number,dva_last_overflow_student_id`))[0]
console.log(' ', fam)

console.log('\n=== siblings + invoices + credit balance ===')
const students = await g(`students?family_id=eq.${FAMILY}&select=id,name,status,credit_balance`)
for (const s of students) {
  console.log(`  ${s.name} (${s.id}) status=${s.status} credit_balance=${s.credit_balance}`)
  const invs = await g(`invoices?student_id=eq.${s.id}&select=id,status,paid_amount,total&order=created_at.desc&limit=5`)
  for (const i of invs) console.log(`      invoice ${i.id} status=${i.status} paid=${i.paid_amount}/${i.total}`)
  const pays = await g(`payments?student_id=eq.${s.id}&select=amount,provider,method,provider_reference,paid_at&order=paid_at.desc&limit=5`)
  for (const p of pays) console.log(`      payment ${p.amount} via ${p.provider}/${p.method} ref=${p.provider_reference} at ${p.paid_at}`)
}

console.log('\n=== schools.last_reconciled_at ===')
const school = (await g(`schools?id=eq.${SCHOOL}&select=last_reconciled_at`))[0]
console.log(' ', school)
