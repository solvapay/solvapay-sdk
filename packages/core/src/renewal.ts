/**
 * Renewal helper types + host `instanceof` guard (Step 52).
 * Decision helpers are Rust-only facades in `native-helpers.ts`.
 * `isRenewalError` stays TypeScript — no Rust binding.
 */

export type RenewalHelperError = {
  error: string
  status: number
  details?: string
}

type PurchaseLike = Record<string, unknown>

function isRenewalHelperError(
  value: PurchaseLike | RenewalHelperError,
): value is RenewalHelperError {
  return 'error' in value && 'status' in value && typeof value.status === 'number'
}

/**
 * Narrow normalize results for shim callers.
 * Host `instanceof`-style guard — intentionally TypeScript (no Rust binding).
 */
export function isRenewalError(
  value: PurchaseLike | RenewalHelperError,
): value is RenewalHelperError {
  return isRenewalHelperError(value)
}
