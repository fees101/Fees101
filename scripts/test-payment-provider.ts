// Manual smoke test for src/lib/payments — not part of the app, not run in CI.
// Exercises MonnifyProvider against a real sandbox account and the
// encryption round-trip, end to end, so you can confirm Slice 1 works
// without needing any UI wired up yet.
//
// Usage:
//   MONNIFY_TEST_API_KEY=... MONNIFY_TEST_SECRET_KEY=... MONNIFY_TEST_CONTRACT_CODE=... \
//     npx tsx scripts/test-payment-provider.ts
//
// Reads PAYMENT_KEYS_ENCRYPTION_SECRET from .env.local automatically if you
// run it with `npx dotenv -e .env.local -- npx tsx scripts/test-payment-provider.ts`,
// or just export it in your shell first.

import { MonnifyProvider } from '../src/lib/payments/monnify'
import { encryptCredential, decryptCredential } from '../src/lib/payments/encryption'
import crypto from 'crypto'

const apiKey = process.env.MONNIFY_TEST_API_KEY
const secretKey = process.env.MONNIFY_TEST_SECRET_KEY
const contractCode = process.env.MONNIFY_TEST_CONTRACT_CODE

if (!apiKey || !secretKey || !contractCode) {
  console.error('Set MONNIFY_TEST_API_KEY, MONNIFY_TEST_SECRET_KEY, MONNIFY_TEST_CONTRACT_CODE and re-run.')
  process.exit(1)
}

async function testEncryption() {
  console.log('=== encryption round-trip ===')
  if (!process.env.PAYMENT_KEYS_ENCRYPTION_SECRET) {
    console.log('SKIPPED — PAYMENT_KEYS_ENCRYPTION_SECRET not set in this shell')
    return
  }
  const original = secretKey!
  const encrypted = encryptCredential(original)
  const decrypted = decryptCredential(encrypted)
  console.log('stored form (never log this shape for real keys):', encrypted.slice(0, 20) + '...')
  console.log('round-trip matches original:', decrypted === original)
}

async function testProvider() {
  const provider = new MonnifyProvider({ apiKey: apiKey!, secretKey: secretKey!, contractCode: contractCode! })
  const ref = `manual-test-${Date.now()}`

  console.log('\n=== createDVA ===')
  const created = await provider.createDVA({
    reference: ref,
    accountName: 'Manual Test Student',
    customerEmail: `student-${ref}@fees101.internal`,
    customerName: 'Manual Test Student',
  })
  console.log(created)

  console.log('\n=== getDVA ===')
  console.log(await provider.getDVA(ref))

  console.log('\n=== getDVA (nonexistent reference) ===')
  console.log('expect null ->', await provider.getDVA('does-not-exist-' + Date.now()))

  console.log('\n=== verifyWebhookSignature ===')
  const body = JSON.stringify({ hello: 'world' })
  const validSig = crypto.createHmac('sha512', secretKey!).update(body).digest('hex')
  console.log('valid signature ->', provider.verifyWebhookSignature(body, validSig), '(expect true)')
  console.log('tampered signature ->', provider.verifyWebhookSignature(body, 'deadbeef'), '(expect false)')
  console.log('tampered body ->', provider.verifyWebhookSignature(body + 'x', validSig), '(expect false)')

  console.log('\n=== deleteDVA ===')
  await provider.deleteDVA(ref)
  console.log('deleted without throwing')

  console.log('\n=== getDVA after delete ===')
  console.log('expect null ->', await provider.getDVA(ref))
}

async function main() {
  await testEncryption()
  await testProvider()
  console.log('\nAll steps completed — check the values above against the "expect" notes.')
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
