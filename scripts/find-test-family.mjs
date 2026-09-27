// Read-only lookup: shows which schools/families have a live family DVA set
// up in test mode, so we know what to fund via Paystack's simulate endpoint.
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const U=env.NEXT_PUBLIC_SUPABASE_URL, K=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'}
const g=p=>fetch(`${U}/rest/v1/${p}`,{headers:H}).then(r=>r.json())

const schools = await g(`schools?payment_provider=eq.paystack&select=id,name,payment_mode`)
console.log('Schools using Paystack:')
for (const s of schools) console.log(`  ${s.id}  ${s.name}  mode=${s.payment_mode}`)

const families = await g(`families?provider_dva_reference=not.is.null&select=id,school_id,provider_dva_reference,provider_dva_account_number,dva_last_overflow_student_id`)
console.log('\nFamilies with a provisioned DVA:')
for (const f of families) console.log(`  family=${f.id} school=${f.school_id} customer_code=${f.provider_dva_reference} account=${f.provider_dva_account_number}`)
