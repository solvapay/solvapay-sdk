import {
  requireProductRef as requireProductRefNative,
  resolveProductRef as resolveProductRefNative,
} from './native-decisions'

function readEnvProductRef(): string | undefined {
  if (typeof process === 'undefined') return undefined
  return process.env.SOLVAPAY_PRODUCT_REF || undefined
}

/** Resolve an explicit option or `SOLVAPAY_PRODUCT_REF`. Does not throw. */
export function resolveProductRef(explicit?: string): string | undefined {
  const resolved = resolveProductRefNative(explicit, readEnvProductRef())
  return resolved ?? undefined
}

/** Resolve a product ref or throw a named `SolvaPayError`. */
export function requireProductRef(explicit?: string): string {
  return requireProductRefNative(explicit, readEnvProductRef())
}
