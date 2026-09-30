// Encrypts payment-provider credentials (schools.provider_api_key /
// provider_secret_key) at rest. AES-256-GCM: random IV per call, auth tag
// guards against tampering, all three parts joined into one stored string.
// Server-only — never import this from a client component.

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

function getKey(): Buffer {
  const secret = process.env.PAYMENT_KEYS_ENCRYPTION_SECRET
  if (!secret) {
    throw new Error('PAYMENT_KEYS_ENCRYPTION_SECRET is not set')
  }
  // Hash an arbitrary-length passphrase down to exactly 32 bytes for AES-256.
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptCredential(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptCredential(stored: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split(':')
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted credential')
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
