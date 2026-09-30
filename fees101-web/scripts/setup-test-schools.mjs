// Two-test-schools setup for provider payment testing.
//   node scripts/setup-test-schools.mjs plan   -> prints what it WILL do, no writes
//   node scripts/setup-test-schools.mjs go      -> preserve Monnify creds, wipe, rebuild
//
// Wipes ALL existing schools + their data + their staff auth users, keeping only
// the school-less super_admin (admin@fees101.com). Then creates two fresh schools
// (Paystack + Monnify), each with the same student (Abdullahi's real phone/email).
import { readFileSync } from 'fs'
import crypto from 'crypto'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const URL_=env.NEXT_PUBLIC_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,authorization:`Bearer ${KEY}`,'content-type':'application/json'}

// --- AES-256-GCM, byte-for-byte identical to src/lib/payments/encryption.ts ---
function encryptCredential(plaintext){
  const secret=env.PAYMENT_KEYS_ENCRYPTION_SECRET
  if(!secret) throw new Error('PAYMENT_KEYS_ENCRYPTION_SECRET missing')
  const key=crypto.createHash('sha256').update(secret).digest()
  const iv=crypto.randomBytes(16)
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv)
  const ct=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()])
  return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),ct.toString('base64')].join(':')
}

async function rest(method,path,body,extra={}){
  const res=await fetch(`${URL_}/rest/v1/${path}`,{method,headers:{...H,Prefer:'return=representation',...extra},body:body?JSON.stringify(body):undefined})
  const text=await res.text()
  if(!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0,300)}`)
  try{const j=text?JSON.parse(text):null;return Array.isArray(j)?j[0]:j}catch{return text}
}
const insert=(t,row)=>rest('POST',t,row)
const del=(path)=>fetch(`${URL_}/rest/v1/${path}`,{method:'DELETE',headers:H}).catch(()=>{})
const get=(p)=>fetch(`${URL_}/rest/v1/${p}`,{headers:H}).then(r=>r.json())

// Child tables ordered so FKs are satisfied (children before parents).
const CHILD_TABLES=['webhook_events','processed_provider_transactions','admin_notifications',
  'message_logs','report_downloads','audit_log','payments','discounts','discount_requests',
  'student_fee_adjustments','invoices','students','fee_items','billing_cycles','sessions',
  'classes','sections','families','roles','school_deletion_requests']

async function wipeSchool(schoolId){
  for(const t of CHILD_TABLES) await del(`${t}?school_id=eq.${schoolId}`)
  // public.users rows for this school (auth users deleted separately by id)
  await del(`users?school_id=eq.${schoolId}`)
  await del(`schools?id=eq.${schoolId}`)
}

const STUDENT={ parentName:'Abdullahi Adedeji', phone:'2348161111055', email:'iamabdullahiadedeji@gmail.com',
  firstName:'Abdullahi', lastName:'Adedeji' }
const PASSWORD='Fees101Test#2026'

async function buildSchool({name, login, provider, creds}){
  console.log(`\n  Building "${name}" (${provider}) ...`)
  const school=await insert('schools',{
    name, academic_year:'2025/2026', subscription_status:'active',
    payment_provider:provider,
    provider_api_key:creds.api, provider_secret_key:creds.secret,
    provider_contract_code:creds.contract ?? null,
    address_city:'Lagos', address_state:'Lagos',
    proprietress_title:'Mrs', proprietress_first_name:'Test', proprietress_last_name:'Owner',
  })
  const schoolId=school.id
  console.log('    school_id:',schoolId)

  // auth user + public.users
  const authRes=await fetch(`${URL_}/auth/v1/admin/users`,{method:'POST',headers:H,
    body:JSON.stringify({email:login,password:PASSWORD,email_confirm:true})})
  const authText=await authRes.text()
  if(!authRes.ok) throw new Error(`auth create ${login} -> ${authRes.status}: ${authText.slice(0,200)}`)
  const userId=JSON.parse(authText).id
  const existing=await get(`users?id=eq.${userId}&select=id`)
  const userRow={id:userId,school_id:schoolId,name:'School Owner',email:login,role:'school_admin',is_active:true}
  if(existing.length) await rest('PATCH',`users?id=eq.${userId}`,userRow)
  else await insert('users',userRow)
  console.log('    login:',login,'/',PASSWORD)

  // academic structure
  const section=await insert('sections',{school_id:schoolId,name:'Primary',display_order:1})
  const klass=await insert('classes',{school_id:schoolId,section_id:section.id,name:'Primary 1',display_order:1,is_active:true})
  const session=await insert('sessions',{school_id:schoolId,name:'2025/2026',status:'active',start_date:'2025-09-01',end_date:'2026-07-31'})
  const cycle=await insert('billing_cycles',{school_id:schoolId,session_id:session.id,name:'First Term',status:'active',start_date:'2025-09-01',end_date:'2025-12-15',due_date:'2025-09-30'})
  await insert('fee_items',{school_id:schoolId,billing_cycle_id:cycle.id,class_id:klass.id,name:'Tuition',amount:50000,is_mandatory:true,display_order:1})

  // family + student (no DVA / invoice — created in browser as the test)
  const family=await insert('families',{school_id:schoolId,primary_parent_name:STUDENT.parentName,primary_parent_phone:STUDENT.phone,primary_parent_email:STUDENT.email})
  const student=await insert('students',{school_id:schoolId,section_id:section.id,class_id:klass.id,family_id:family.id,
    first_name:STUDENT.firstName,last_name:STUDENT.lastName,admission_number:`${provider==='paystack'?'PS':'MN'}/2026/001`,status:'active'})
  console.log('    student:',STUDENT.firstName,STUDENT.lastName,'->',student.id)
  return {schoolId,userId,login}
}

async function main(mode){
  const schools=await get('schools?select=id,name,payment_provider,provider_api_key,provider_secret_key,provider_contract_code')
  const users=await get('users?select=id,email,school_id,role')

  // 1. Preserve Monnify ciphertext from whichever school currently has it.
  const monnifySrc=schools.find(s=>s.payment_provider==='monnify'&&s.provider_secret_key)
  if(!monnifySrc) throw new Error('No existing Monnify credentials found to copy!')
  const monnifyCreds={api:monnifySrc.provider_api_key,secret:monnifySrc.provider_secret_key,contract:monnifySrc.provider_contract_code}
  console.log(`Monnify creds source: "${monnifySrc.name}" (contract ${monnifyCreds.contract?'set':'MISSING'})`)

  const paystackCreds={api:encryptCredential(env.PAYSTACK_TEST_PUBLIC_KEY),secret:encryptCredential(env.PAYSTACK_TEST_SECRET_KEY),contract:null}

  const staffUsers=users.filter(u=>u.school_id) // everyone school-scoped (super_admin has null school_id)
  console.log(`\nWill DELETE ${schools.length} school(s):`)
  for(const s of schools) console.log(`  - ${s.name} (${s.id})`)
  console.log(`Will DELETE ${staffUsers.length} staff auth user(s):`)
  for(const u of staffUsers) console.log(`  - ${u.email} (${u.role})`)
  const keep=users.filter(u=>!u.school_id)
  console.log(`Will KEEP ${keep.length}: ${keep.map(u=>u.email).join(', ')}`)

  if(mode!=='go'){ console.log('\n[plan only] re-run with `go` to execute.'); return }

  console.log('\n--- WIPING ---')
  for(const s of schools){ console.log('  wiping',s.name); await wipeSchool(s.id) }
  for(const u of staffUsers){ await fetch(`${URL_}/auth/v1/admin/users/${u.id}`,{method:'DELETE',headers:H}).catch(()=>{}) }
  console.log('  wipe complete.')

  console.log('\n--- BUILDING ---')
  const ps=await buildSchool({name:'Paystack Test School',login:'paystack@school.com',provider:'paystack',creds:paystackCreds})
  const mn=await buildSchool({name:'Monnify Test School',login:'monnify@school.com',provider:'monnify',creds:monnifyCreds})

  console.log('\n=== DONE ===')
  console.log(`Paystack: ${ps.login} / ${PASSWORD}  (school ${ps.schoolId})`)
  console.log(`Monnify:  ${mn.login} / ${PASSWORD}  (school ${mn.schoolId})`)
}

await main(process.argv[2])
