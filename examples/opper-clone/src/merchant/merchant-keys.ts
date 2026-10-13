// The clone's toy version of Opper's own API keys (prototype spec §2.1 clone
// rule 3). A caller presents one the way Claude Code sends any API key; the
// SolvaPay agent token takes this place in S2.
import { readFile } from 'node:fs/promises'
import { isRecord, requireString } from '../lib/guards'

export const MERCHANT_KEY_PREFIX = 'op-clone-'

export interface MerchantKeyEntry {
  key: string
  userRef: string
  label: string
}

export interface MerchantKeys {
  /** The user behind a presented key, or null for an unknown key. */
  resolve(presented: string): string | null
}

export function merchantKeysFrom(entries: MerchantKeyEntry[]): MerchantKeys {
  const byKey = new Map(entries.map(entry => [entry.key, entry.userRef]))
  return { resolve: presented => byKey.get(presented) ?? null }
}

export async function readMerchantKeyFile(path: string): Promise<MerchantKeyEntry[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.keys)) {
    throw new Error(`${path} must be {"keys": [...]}`)
  }
  return parsed.keys.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}: keys[${index}] is not an object`)
    return {
      key: requireString(entry.key, `keys[${index}].key`),
      userRef: requireString(entry.userRef, `keys[${index}].userRef`),
      label: requireString(entry.label, `keys[${index}].label`),
    }
  })
}

/** The key from `x-api-key` (ANTHROPIC_API_KEY) or `Authorization: Bearer` (ANTHROPIC_AUTH_TOKEN). */
export function presentedKey(request: Request): string | null {
  const apiKey = request.headers.get('x-api-key')?.trim()
  if (apiKey) return apiKey
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1]?.trim() || null
}
