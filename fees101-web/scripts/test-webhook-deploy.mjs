// Deploy smoke test: fire signed webhooks at the PREVIEW url. Non-polluting —
// replays an already-processed reference so it hits the idempotency path
// (no new payment, no receipt), plus a tampered-signature rejection check.
import { readFileSync } from 'fs'
import crypto from 'crypto'
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const SECRET=env.PAYSTACK_TEST_SECRET_KEY
const HOOK=process.argv[2]
const CUS='CUS_wtc8alit8mxwsi0'
const sign=b=>crypto.createHmac('sha512',SECRET).update(b).digest('hex')
async function post(rawBody,signature){
  const res=await fetch(HOOK,{method:'POST',headers:{'content-type':'application/json','x-paystack-signature':signature},body:rawBody})
  const text=await res.text(); let j; try{j=JSON.parse(text)}catch{j=text.slice(0,120)}
  const vercelWall = typeof j==='string' && /Authentication Required|vercel|<!doctype/i.test(j)
  return {status:res.status, body:j, vercelWall}
}
const payload=JSON.stringify({event:'charge.success',data:{reference:'test-wh-001',amount:5000000,fees:50000,status:'success',paid_at:'2026-08-28T12:00:00.000Z',customer:{customer_code:CUS}}})

console.log('Target:',HOOK,'\n')
console.log('TEST A — valid signature, already-processed ref (expect 200 "Duplicate")')
let r=await post(payload,sign(payload))
console.log('  ->',r.status, r.vercelWall?'[BLOCKED BY VERCEL DEPLOYMENT PROTECTION]':JSON.stringify(r.body))

console.log('\nTEST B — tampered signature (expect 401 Invalid signature)')
r=await post(payload,sign(payload)+'00')
console.log('  ->',r.status, r.vercelWall?'[BLOCKED BY VERCEL DEPLOYMENT PROTECTION]':JSON.stringify(r.body))
