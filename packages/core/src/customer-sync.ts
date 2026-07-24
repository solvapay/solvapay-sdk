/**
 * Customer-sync / ensureCustomer types (Step 26 / Step 52).
 * Decision helpers are Rust-only facades in `native-helpers.ts`.
 */

export type CustomerRefKind = 'anonymous' | 'backend' | 'needsEnsure'
export type LookupErrorKind = 'expectedMissing' | 'unexpected'
export type CreateErrorKind = 'conflict' | 'other'

export type CoercedCustomerOptions = {
  email?: string
  name?: string
}

export type CreateCustomerParams = {
  email: string
  name?: string
  externalRef?: string
  metadata: Record<string, unknown>
}
