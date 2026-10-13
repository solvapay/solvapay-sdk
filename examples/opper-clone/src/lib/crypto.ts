// Ported from solvapay/opper-mcp src/lib/crypto.ts (WebCrypto AES-GCM).
import { isRecord, requireString } from './guards'

const ALGORITHM = 'AES-GCM'
const IV_BYTES = 12

export interface EncryptedPayload {
  iv: string
  ciphertext: string
}

export async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  const raw = Buffer.from(base64Key, 'base64')
  if (raw.byteLength !== 32) {
    throw new Error('CLONE_KEY_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  }
  return crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['encrypt', 'decrypt'])
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(cipher).toString('base64'),
  }
}

export async function decryptString(key: CryptoKey, payload: EncryptedPayload): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: Buffer.from(payload.iv, 'base64') },
    key,
    Buffer.from(payload.ciphertext, 'base64'),
  )
  return new TextDecoder().decode(plain)
}

export function parseEncryptedPayload(value: unknown): EncryptedPayload {
  if (!isRecord(value)) throw new Error('Encrypted payload is not an object')
  return {
    iv: requireString(value.iv, 'iv'),
    ciphertext: requireString(value.ciphertext, 'ciphertext'),
  }
}
