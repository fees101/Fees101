// Provisions ONE brand-new, genuinely blank onboarding-test school — no wipe,
// does not touch the existing Paystack/Monnify test schools. Mirrors how the
// platform owner provisions a school today (no admin-dashboard UI yet): a
// direct insert with just a name, no payment provider, no academic structure,
// no students. Everything else is meant to be filled in by the school admin's
// own first-login walkthrough (the thing we're about to test in the browser).
//
//   node scripts/create-onboarding-test-school.mjs plan   -> print only
//   node scripts/create-onboarding-test-school.mjs go     -> create it
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const URL_=env.NEXT_PUBLIC_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,authorization:`Bearer ${KEY}`,'content-type':'application/json'}

const SCHOOL_NAME = 'Greenfield Comprehensive Academy'
const LOGIN = 'onboarding@school.com'
const PASSWORD = 'Fees101Test#2026'

async function rest(method,path,body,extra={}){
  const res=await fetch(`${URL_}/rest/v1/${path}`,{method,headers:{...H,Prefer:'return=representation',...extra},body:body?JSON.stringify(body):undefined})
  const text=await res.text()
  if(!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0,300)}`)
  try{const j=text?JSON.parse(text):null;return Array.isArray(j)?j[0]:j}catch{return text}
}
const get=(p)=>fetch(`${URL_}/rest/v1/${p}`,{headers:H}).then(r=>r.json())

async function main(mode){
  const existing = await get(`schools?name=eq.${encodeURIComponent(SCHOOL_NAME)}&select=id`)
  if (existing.length) {
    console.log(`"${SCHOOL_NAME}" already exists (${existing[0].id}). Nothing to do.`)
    return
  }

  console.log(`Will create school "${SCHOOL_NAME}" with owner login ${LOGIN} / ${PASSWORD}`)
  console.log('No payment provider, no classes/sessions/cycles/fees/students — a true blank slate.')
  if (mode !== 'go') { console.log('\n[plan only] re-run with `go` to execute.'); return }

  const school = await rest('POST', 'schools', { name: SCHOOL_NAME, subscription_status: 'active' })
  const schoolId = school.id
  console.log('school_id:', schoolId)

  const authRes = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H,
    body: JSON.stringify({ email: LOGIN, password: PASSWORD, email_confirm: true }) })
  const authText = await authRes.text()
  if (!authRes.ok) throw new Error(`auth create ${LOGIN} -> ${authRes.status}: ${authText.slice(0,200)}`)
  const userId = JSON.parse(authText).id

  await rest('POST', 'users', { id: userId, school_id: schoolId, name: 'Adaeze Okafor', email: LOGIN, role: 'school_admin', is_active: true })

  console.log('\n=== DONE ===')
  console.log(`Login: ${LOGIN} / ${PASSWORD}`)
  console.log(`school_id: ${schoolId}`)
}

await main(process.argv[2])
