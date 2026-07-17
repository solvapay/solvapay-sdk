/**
 * Pure customer-sync / ensureCustomer decision helpers (Step 26).
 *
 * I/O, caches, and the shared deduplicator stay in `@solvapay/server`.
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

/** Classify a customerRef before ensure/lookup (anonymous / cus_ / needs ensure). */
export function classifyCustomerRef(customerRef: string): CustomerRefKind {
  if (customerRef === 'anonymous') return 'anonymous'
  if (customerRef.startsWith('cus_')) return 'backend'
  return 'needsEnsure'
}

/**
 * JS falsy coercion used by syncCustomerCore: `null` / `''` → omitted
 * (`email || undefined`).
 */
export function coerceCustomerOptions(
  email: string | null | undefined,
  name: string | null | undefined,
): CoercedCustomerOptions {
  const options: CoercedCustomerOptions = {}
  const coercedEmail = email || undefined
  const coercedName = name || undefined
  if (coercedEmail !== undefined) options.email = coercedEmail
  if (coercedName !== undefined) options.name = coercedName
  return options
}

/**
 * Build createCustomer params, including the fallback email template
 * `{customerRef}-{epochMs}@auto-created.local`.
 */
export function buildCreateCustomerParams(
  customerRef: string,
  externalRef: string | undefined,
  email: string | undefined,
  name: string | undefined,
  nowMs: number,
): CreateCustomerParams {
  const params: CreateCustomerParams = {
    email: email || `${customerRef}-${nowMs}@auto-created.local`,
    metadata: {},
  }
  if (name) {
    params.name = name
  }
  if (externalRef) {
    params.externalRef = externalRef
  }
  return params
}

/** Prefer `customerRef`, then `reference`, then `fallback`. */
export function extractBackendCustomerRef(
  response: Record<string, unknown>,
  fallback: string,
): string {
  const customerRef = response.customerRef
  if (typeof customerRef === 'string' && customerRef.length > 0) return customerRef
  const reference = response.reference
  if (typeof reference === 'string' && reference.length > 0) return reference
  return fallback
}

/** 404 / "not found" → expected missing; everything else unexpected. */
export function classifyLookupError(message: string): LookupErrorKind {
  if (message.includes('404') || message.includes('not found')) {
    return 'expectedMissing'
  }
  return 'unexpected'
}

/** 409 / "already exists" → conflict; everything else other. */
export function classifyCreateError(message: string): CreateErrorKind {
  if (message.includes('409') || message.includes('already exists')) {
    return 'conflict'
  }
  return 'other'
}

/**
 * Email-uniqueness conflict branch inside ensureCustomer 409 recovery
 * (`message.includes('email') || message.includes('identifier email')`).
 */
export function isEmailConflict(message: string): boolean {
  return message.includes('email') || message.includes('identifier email')
}
