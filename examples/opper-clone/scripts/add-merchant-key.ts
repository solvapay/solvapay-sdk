// Adds a toy merchant key for a user and prints it once.
// Usage: pnpm merchant-key <userRef> <label>
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MERCHANT_KEY_PREFIX, readMerchantKeyFile } from '../src/merchant/merchant-keys'

const [userRef, label] = process.argv.slice(2)
if (!userRef || !label || !/^[a-z0-9_-]+$/i.test(userRef)) {
  console.error('Usage: pnpm merchant-key <userRef> <label>  (userRef: letters, digits, _ or -)')
  process.exit(1)
}

const dataDir = fileURLToPath(new URL('../data/', import.meta.url))
const path = join(dataDir, 'merchant-keys.json')
const keys = await readMerchantKeyFile(path)
const key = `${MERCHANT_KEY_PREFIX}${randomBytes(24).toString('base64url')}`
keys.push({ key, userRef, label })
await mkdir(dataDir, { recursive: true })
await writeFile(path, JSON.stringify({ keys }, null, 2), { mode: 0o600 })

process.stdout.write(
  `Added a key for ${userRef} (${label}). Restart the clone, then:\n` +
    `ANTHROPIC_BASE_URL=http://localhost:3040/v3/compat ANTHROPIC_API_KEY=${key} claude\n`,
)
