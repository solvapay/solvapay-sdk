/**
 * Shadow-mode deep-equal comparator + divergence records (step 25).
 */

import { normalizeVolatile, type ShadowNormalizeRules } from './normalize.js'

/** One HTTP exchange captured on either side. */
export type WireExchange = {
  method: string
  url: string
  requestHeaders?: Record<string, string>
  requestBody?: unknown
  status?: number
  responseHeaders?: Record<string, string>
  responseBody?: unknown
}

/**
 * Outcome of one side for a scenario.
 *
 * Step 53: the two sides are the npm facade binding (WASM `FetchTransport`) and
 * the Rust CLI (shadow-invoker). The `ts*` field/label names below are retained
 * only for report/golden compatibility — "ts" now denotes the facade side, not
 * a TypeScript implementation.
 */
export type SideOutcome = {
  ok: boolean
  /** Success value or structured error observation. */
  value: unknown
  wire: WireExchange[]
}

export type Divergence = {
  op: string
  args: unknown
  tsNormalized: unknown
  rustNormalized: unknown
  tsRaw: unknown
  rustRaw: unknown
  /**
   * Facade-side wire dump. Serialized key remains `tsWire` for persisted
   * shadow-report compatibility (Step 53: facade ≠ TypeScript body).
   */
  tsWire: WireExchange[]
  rustWire: WireExchange[]
  path?: string
}

export type CompareResult =
  | { identical: true; tsNormalized: unknown; rustNormalized: unknown }
  | { identical: false; divergence: Divergence }

/**
 * Deep equality that treats numbers as equal when their f64 values match
 * (`25` == `25.0`) — matches the Rust fixture harness convention.
 */
export function deepEqualNormalized(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left === right || (Number.isNaN(left) && Number.isNaN(right))
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false
    }
    return left.every((item, i) => deepEqualNormalized(item, right[i]))
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const l = left as Record<string, unknown>
    const r = right as Record<string, unknown>
    const lKeys = Object.keys(l)
    const rKeys = Object.keys(r)
    if (lKeys.length !== rKeys.length) {
      return false
    }
    return lKeys.every(key => key in r && deepEqualNormalized(l[key], r[key]))
  }
  return false
}

/** First JSON-path-like difference, or undefined when equal. */
export function firstDiffPath(left: unknown, right: unknown, path = ''): string | undefined {
  if (deepEqualNormalized(left, right)) {
    return undefined
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const len = Math.max(left.length, right.length)
    for (let i = 0; i < len; i += 1) {
      const child = firstDiffPath(left[i], right[i], `${path}[${i}]`)
      if (child !== undefined) {
        return child
      }
    }
    return path || '/'
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const l = left as Record<string, unknown>
    const r = right as Record<string, unknown>
    const keys = new Set([...Object.keys(l), ...Object.keys(r)])
    for (const key of keys) {
      const childPath = path === '' ? `/${key}` : `${path}/${key}`
      if (!(key in l) || !(key in r)) {
        return childPath
      }
      const child = firstDiffPath(l[key], r[key], childPath)
      if (child !== undefined) {
        return child
      }
    }
  }
  return path || '/'
}

/**
 * Error observations compare on name / message / status only (step 25 gotcha:
 * identical SolvaPayError message + status). Drop binding-private fields.
 */
function canonicalizeOutcomeValue(ok: boolean, value: unknown): unknown {
  if (ok) return value
  if (typeof value !== 'object' || value === null) return value
  const obj = value as Record<string, unknown>
  return {
    name: obj.name,
    message: obj.message,
    status: obj.status ?? null,
  }
}

/**
 * Normalize both sides with the same rules and deep-equal compare.
 * On mismatch, build a Divergence carrying raw + normalized + both wire dumps.
 */
export function compareSides(input: {
  op: string
  args: unknown
  ts: SideOutcome
  rust: SideOutcome
  rules: ShadowNormalizeRules
}): CompareResult {
  const tsRaw = { ok: input.ts.ok, value: input.ts.value }
  const rustRaw = { ok: input.rust.ok, value: input.rust.value }
  const tsNormalized = {
    ok: input.ts.ok,
    value: normalizeVolatile(canonicalizeOutcomeValue(input.ts.ok, input.ts.value), input.rules),
  }
  const rustNormalized = {
    ok: input.rust.ok,
    value: normalizeVolatile(
      canonicalizeOutcomeValue(input.rust.ok, input.rust.value),
      input.rules,
    ),
  }

  if (deepEqualNormalized(tsNormalized, rustNormalized)) {
    return { identical: true, tsNormalized, rustNormalized }
  }

  return {
    identical: false,
    divergence: {
      op: input.op,
      args: input.args,
      tsNormalized,
      rustNormalized,
      tsRaw,
      rustRaw,
      tsWire: input.ts.wire,
      rustWire: input.rust.wire,
      path: firstDiffPath(tsNormalized, rustNormalized),
    },
  }
}
