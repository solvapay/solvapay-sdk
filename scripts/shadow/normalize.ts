/**
 * Shadow-mode volatile-field normalizer (step 25).
 *
 * Removes non-deterministic fields (timestamps, generated refs, secrets)
 * using manifest `shadow:` rules before deep-equal compare.
 *
 * Volatile object keys are **deleted** (not replaced) so typed Rust responses
 * that never surface those keys stay comparable to TS `res.json()` passthrough.
 */

import type { SdkContractManifest } from '../lib/manifest-schema.js'

/** Sentinel substituted for volatile ref tokens embedded in otherwise-stable strings. */
export const VOLATILE_SENTINEL = '<volatile>'

/** Effective rules for one normalize pass. */
export type ShadowNormalizeRules = {
  globalVolatileKeys: readonly string[]
  volatileKeySuffixes: readonly string[]
  refPrefixes: readonly string[]
  /** RFC 6901 JSON Pointers (absolute, starting with `/`). */
  pointers: readonly string[]
}

/** Build rules from the manifest global block + one operation's pointers. */
export function shadowRulesForOperation(
  manifest: SdkContractManifest,
  operationId: string,
): ShadowNormalizeRules {
  const global = manifest.shadow
  const op = manifest.operations[operationId]
  return {
    globalVolatileKeys: global.globalVolatileKeys,
    volatileKeySuffixes: global.volatileKeySuffixes,
    refPrefixes: global.refPrefixes,
    pointers: op?.shadow.volatile ?? [],
  }
}

/**
 * Deep-clone `value` and strip volatile fields per `rules`.
 *
 * - Applies JSON Pointer deletions first.
 * - Then walks the tree: keys in `globalVolatileKeys` or ending with a
 *   `volatileKeySuffixes` entry are removed.
 * - Remaining string values matching `refPrefixes` (standalone or in URLs),
 *   ISO-8601 timestamps, emails, and opaque `?id=` session tokens are replaced
 *   with {@link VOLATILE_SENTINEL}.
 * - Explicit `null` is dropped (treated as absent) so typed Rust omit-empty
 *   matches TS `res.json()` null passthrough for optional fields.
 */
export function normalizeVolatile(value: unknown, rules: ShadowNormalizeRules): unknown {
  const cloned = structuredClone(value) as unknown
  for (const pointer of rules.pointers) {
    deletePointer(cloned, pointer)
  }
  return walk(cloned, rules)
}

function isVolatileKey(key: string, rules: ShadowNormalizeRules): boolean {
  if (rules.globalVolatileKeys.includes(key)) {
    return true
  }
  return rules.volatileKeySuffixes.some(suffix => key.endsWith(suffix))
}

function walk(value: unknown, rules: ShadowNormalizeRules): unknown {
  if (Array.isArray(value)) {
    return value.map(item => walk(item, rules))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isVolatileKey(key, rules)) {
        continue
      }
      // Drop undefined/null so TS null passthrough matches Rust omit-empty.
      if (child === undefined || child === null) {
        continue
      }
      out[key] = walk(child, rules)
    }
    return out
  }
  if (typeof value === 'string') {
    return normalizeVolatileString(value, rules)
  }
  return value
}

/** ISO-8601 timestamps (with optional fractional seconds / Z / offset). */
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g

/** Hosted-page / session opaque ids in query strings. */
const QUERY_ID_RE = /([?&]id=)[0-9a-fA-F]{16,}/g

/** Email addresses embedded in error messages or bodies. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

function normalizeVolatileString(value: string, rules: ShadowNormalizeRules): string {
  if (rules.refPrefixes.some(prefix => value.startsWith(prefix))) {
    return VOLATILE_SENTINEL
  }
  let result = value
  for (const prefix of rules.refPrefixes) {
    const re = new RegExp(`${escapeRegExp(prefix)}[A-Za-z0-9_-]+`, 'g')
    result = result.replace(re, VOLATILE_SENTINEL)
  }
  result = result.replace(ISO_TIMESTAMP_RE, VOLATILE_SENTINEL)
  result = result.replace(QUERY_ID_RE, `$1${VOLATILE_SENTINEL}`)
  result = result.replace(EMAIL_RE, VOLATILE_SENTINEL)
  return result
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** RFC 6901 decode: `~1` → `/`, `~0` → `~`. */
function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Delete the value at `pointer` (no-op if path missing). */
function deletePointer(root: unknown, pointer: string): void {
  if (pointer === '' || pointer === '/') {
    return
  }
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer (must start with /): ${pointer}`)
  }
  const tokens = pointer.slice(1).split('/').map(decodePointerToken)
  let current: unknown = root
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i]
    if (current === null || typeof current !== 'object') {
      return
    }
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return
      }
      current = current[index]
    } else {
      const obj = current as Record<string, unknown>
      if (!(token in obj)) {
        return
      }
      current = obj[token]
    }
  }
  const last = tokens[tokens.length - 1]
  if (current === null || typeof current !== 'object') {
    return
  }
  if (Array.isArray(current)) {
    const index = Number(last)
    if (Number.isInteger(index) && index >= 0 && index < current.length) {
      current.splice(index, 1)
    }
    return
  }
  delete (current as Record<string, unknown>)[last]
}
