/**
 * Pure purchase helper decision cores (Step 29).
 *
 * Auth, HTTP, and the 500ms settle delay stay in `@solvapay/server` helpers.
 */

/**
 * Filter purchases to those with `status === 'active'`.
 */
export function selectActivePurchases<T extends { status?: string }>(purchases: T[]): T[] {
  return purchases.filter(p => p.status === 'active')
}

/**
 * Fast-path predicate: cached customer is usable when `customerRef` is truthy
 * and `externalRef` is truthy and equals `userId`.
 */
export function isCachedCustomerRefValid(
  externalRef: string | null | undefined,
  userId: string,
  customerRef: string | null | undefined,
): boolean {
  if (!customerRef) {
    return false
  }
  return Boolean(externalRef && externalRef === userId)
}

/**
 * Resolve response `customerRef` with JS-falsy fallback: `customerRef || userId`.
 */
export function resolvePurchaseCustomerRef(
  customerRef: string | null | undefined,
  userId: string,
): string {
  return customerRef || userId
}
