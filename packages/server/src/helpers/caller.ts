/**
 * The SolvaPay customer a route helper acts for.
 *
 * Route helpers read the caller from the request (`getAuthenticatedUserCore`).
 * On the web routes that is the merchant's user, so the customer is always
 * found by `externalRef` (the user id), never taken from the id itself, even
 * when it starts with `cus_`: a user whose id looks like a customer ref must
 * not reach that customer.
 *
 * Server code that already knows the customer, such as `@solvapay/mcp-core`'s
 * widget tools (the signed-in `customer_ref` from MCP OAuth), says so by
 * marking the `Request` it builds. A browser can set headers but not this
 * property, and `Symbol.for` makes the mark the same across bundles and
 * package copies. A marked ref resolves as `ensureCustomer` does: a `cus_`
 * ref as itself, anything else by `externalRef`.
 */
import type { SolvaPay } from '../factory'

export const CUSTOMER_REF_MARK = Symbol.for('solvapay.customerRef')

/** Marks `request` as acting for `customerRef`, named by trusted server code. */
export function withCustomerRef(request: Request, customerRef: string): Request {
  Object.defineProperty(request, CUSTOMER_REF_MARK, { value: customerRef, enumerable: false })
  return request
}

export function markedCustomerRef(request: Request): string | undefined {
  const value = (request as unknown as Record<symbol, unknown>)[CUSTOMER_REF_MARK]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function resolveCallerCustomer(
  request: Request,
  solvaPay: SolvaPay,
  user: { userId: string; email?: string | null; name?: string | null },
): Promise<string> {
  const details = { email: user.email || undefined, name: user.name || undefined }
  const marked = markedCustomerRef(request)
  if (marked) return solvaPay.ensureCustomer(marked, marked, details)
  return solvaPay.ensureCustomerForUser(user.userId, details)
}
