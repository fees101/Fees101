import { readFileSync } from 'fs'
import crypto from 'crypto'
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const URL_=env.NEXT_PUBLIC_SUPABASE_URL,KEY=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,authorization:`Bearer ${KEY}`}
const get=(p)=>fetch(`${URL_}/rest/v1/${p}`,{headers:H}).then(r=>r.json())
function decrypt(stored){
  const key=crypto.createHash('sha256').update(env.PAYMENT_KEYS_ENCRYPTION_SECRET).digest()
  const [iv,tag,ct]=stored.split(':')
  const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'))
  d.setAuthTag(Buffer.from(tag,'base64'))
  return Buffer.concat([d.update(Buffer.from(ct,'base64')),d.final()]).toString('utf8')
}
const mask=s=>s.slice(0,10)+'…'+s.slice(-4)

for(const s of await get('schools?select=*&order=name')){
  console.log(`\n### ${s.name} (${s.payment_provider}) — ${s.id}`)
  console.log('  api key   :', mask(decrypt(s.provider_api_key)))
  console.log('  secret key:', mask(decrypt(s.provider_secret_key)))
  console.log('  contract  :', s.provider_contract_code || '(none)')
  const [sess]=await get(`sessions?school_id=eq.${s.id}&select=name,status`)
  const [cyc]=await get(`billing_cycles?school_id=eq.${s.id}&select=name,status,due_date`)
  const [cls]=await get(`classes?school_id=eq.${s.id}&select=name`)
  const [fee]=await get(`fee_items?school_id=eq.${s.id}&select=name,amount,is_mandatory`)
  const [fam]=await get(`families?school_id=eq.${s.id}&select=primary_parent_name,primary_parent_phone,primary_parent_email`)
  const [stu]=await get(`students?school_id=eq.${s.id}&select=first_name,last_name,admission_number,provider_dva_account_number`)
  const usr=await get(`users?school_id=eq.${s.id}&select=email,role`)
  console.log('  session   :', sess?.name, `(${sess?.status})`)
  console.log('  term      :', cyc?.name, `(${cyc?.status}, due ${cyc?.due_date})`)
  console.log('  class     :', cls?.name)
  console.log('  fee       :', fee?.name, `₦${fee?.amount}`, fee?.is_mandatory?'(mandatory)':'')
  console.log('  parent    :', fam?.primary_parent_name, fam?.primary_parent_phone, fam?.primary_parent_email)
  console.log('  student   :', stu?.first_name, stu?.last_name, stu?.admission_number, 'DVA:', stu?.provider_dva_account_number||'(none yet)')
  console.log('  users     :', usr.map(u=>`${u.email}(${u.role})`).join(', '))
}
// Confirm the decrypted Paystack keys match .env.local exactly.
const [ps]=await get(`schools?payment_provider=eq.paystack&select=provider_api_key,provider_secret_key`)
console.log('\n### Paystack key match vs .env.local')
console.log('  public key matches:', decrypt(ps.provider_api_key)===env.PAYSTACK_TEST_PUBLIC_KEY)
console.log('  secret key matches:', decrypt(ps.provider_secret_key)===env.PAYSTACK_TEST_SECRET_KEY)
