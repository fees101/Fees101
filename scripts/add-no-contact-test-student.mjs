// One-off: adds a student with NO family (family_id null → no parent phone/email)
// to the Paystack Test School, plus a real pending invoice for them, so
// "Send to parent" / bulk send can be tested end-to-end without ever making
// a real SMS/email call — sendInvoiceCore() fails fast on the missing
// phone+email before it reaches Sendchamp/email. Safe to re-run (skips if
// the test student already exists).
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const URL_=env.NEXT_PUBLIC_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,authorization:`Bearer ${KEY}`,'content-type':'application/json'}

const SCHOOL_ID = 'd80be88f-c95b-4205-9698-75f806343d84' // Paystack Test School
const SECTION_ID = 'bf8bf514-769d-4c1e-bc79-99b37a891ad8'
const CLASS_ID = 'cbfc1e28-6a94-4b7d-b815-e6055c7297b6'
const CYCLE_ID = '1e085dea-a6d6-425f-97da-acf2d800c817' // First Term

async function rest(method,path,body){
  const res=await fetch(`${URL_}/rest/v1/${path}`,{method,headers:{...H,Prefer:'return=representation'},body:body?JSON.stringify(body):undefined})
  const text=await res.text()
  if(!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0,300)}`)
  try{const j=text?JSON.parse(text):null;return Array.isArray(j)?j[0]:j}catch{return text}
}
const get=(p)=>fetch(`${URL_}/rest/v1/${p}`,{headers:H}).then(r=>r.json())

const ADMISSION_NUMBER = 'TEST-NOCONTACT-001'

async function main() {
  const existing = await get(`students?school_id=eq.${SCHOOL_ID}&admission_number=eq.${ADMISSION_NUMBER}&select=id`)
  let studentId
  if (existing.length) {
    studentId = existing[0].id
    console.log('Student already exists:', studentId)
  } else {
    const student = await rest('POST','students',{
      school_id: SCHOOL_ID,
      section_id: SECTION_ID,
      class_id: CLASS_ID,
      family_id: null, // <- no family = no parent phone/email anywhere to send to
      first_name: 'Test',
      last_name: 'NoContact',
      admission_number: ADMISSION_NUMBER,
      admission_date: new Date().toISOString().slice(0,10),
      status: 'active',
    })
    studentId = student.id
    console.log('Created student:', studentId)
  }

  const existingInvoice = await get(`invoices?school_id=eq.${SCHOOL_ID}&student_id=eq.${studentId}&billing_cycle_id=eq.${CYCLE_ID}&select=id`)
  if (existingInvoice.length) {
    console.log('Invoice already exists:', existingInvoice[0].id)
    return
  }

  const invoice = await rest('POST','invoices',{
    school_id: SCHOOL_ID,
    student_id: studentId,
    billing_cycle_id: CYCLE_ID,
    line_items: [{ kind: 'required', name: 'Tuition', amount: 50000 }],
    selected_extras_ids: [],
    discount_amount: 0,
    subtotal: 50000,
    total_amount: 50000,
    paid_amount: 0,
    status: 'pending',
    generated_at: new Date().toISOString(),
    sent_at: null,
    needs_resend: false,
  })
  console.log('Created invoice:', invoice.id, '- outstanding ₦50,000, never sent')
}

await main()
