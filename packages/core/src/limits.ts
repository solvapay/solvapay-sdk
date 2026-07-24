/**
 * Limits helper types (Step 52). Helpers are Rust-only in `native-helpers.ts`.
 */

export type LimitsHelperError = { error: string; status: number }

export type CheckLimitsParams = {
  productRef: string
  meterName: string
}
