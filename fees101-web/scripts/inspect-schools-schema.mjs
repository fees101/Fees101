// Read-only: print one schools row so we know which columns are NOT NULL /
// required before inserting a brand-new blank onboarding-test school.
import { readFileSync } from 'fs'

const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const URL_=env.NEXT_PUBLIC_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,authorization:`Bearer ${KEY}`}

const res = await fetch(`${URL_}/rest/v1/schools?select=*&limit=1`, { headers: H })
const rows = await res.json()
console.log(JSON.stringify(rows[0], null, 2))
