import { SolvaPayError } from '@solvapay/core'

const MISSING_PRODUCT_REF_MESSAGE =
  'No product ref resolved. Pass productRef to payable() or set SOLVAPAY_PRODUCT_REF. ' +
  'Run `npx solvapay doctor` to diagnose.'

function readEnvProductRef(): string | undefined {
  if (typeof process === 'undefined') return undefined
  return process.env.SOLVAPAY_PRODUCT_REF || undefined
}

/** Resolve an explicit option or `SOLVAPAY_PRODUCT_REF`. Does not throw. */
export function resolveProductRef(explicit?: string): string | undefined {
  if (explicit) return explicit
  return readEnvProductRef()
}

/** Resolve a product ref or throw a named `SolvaPayError`. */
export function requireProductRef(explicit?: string): string {
  const resolved = resolveProductRef(explicit)
  if (!resolved) {
    throw new SolvaPayError(MISSING_PRODUCT_REF_MESSAGE)
  }
  return resolved
}
