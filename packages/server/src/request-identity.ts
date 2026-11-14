/**
 * Who a `payable.http` / `payable.next` / `payable.gate` request is for, when
 * the merchant passes no `getCustomerRef`.
 *
 * Nothing the caller sends is trusted on its own:
 * 1. `Authorization: Bearer <token>` names a user only once `verifyBearerToken`
 *    (from `@solvapay/auth`) verifies it: an HS256 secret, a JWKS, or a gateway
 *    the merchant opted into. A token that can't be verified is refused (401).
 * 2. `x-customer-ref` names a customer only behind a trusted gateway
 *    (`SOLVAPAY_AUTH_TRUST_GATEWAY=true`), because a browser or API client can
 *    set it to anyone. Sent without that opt-in, it is refused (401).
 * 3. With neither, the request is anonymous: no customer.
 */
import { SolvaPayError } from '@solvapay/core'
import { verifyBearerToken } from '@solvapay/auth'

export type RequestIdentity =
  /** A customer the merchant named (`getCustomerRef`) or a trusted gateway set: `cus_…` or the merchant's own id. */
  | { kind: 'customer'; customerRef: string }
  /** The subject of a verified token: always the merchant's user id, never a `cus_` ref. */
  | { kind: 'user'; userId: string; email?: string; name?: string }
  | { kind: 'anonymous' }

export const CUSTOMER_REF_HEADER = 'x-customer-ref'

const UNTRUSTED_CUSTOMER_HEADER =
  'x-customer-ref names the customer only behind a trusted gateway. Pass getCustomerRef, send a ' +
  'verified bearer token, or set SOLVAPAY_AUTH_TRUST_GATEWAY=true if a gateway sets this header ' +
  'on every request.'

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const deno = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno
  const value = proc?.env?.[name] ?? deno?.env?.get(name)
  return value && value.length > 0 ? value : undefined
}

export function unauthorized(message: string): SolvaPayError {
  return new SolvaPayError(message, { status: 401, code: 'unauthorized' })
}

/** True for the 401 `identifyRequest` throws, so adapters answer 401 rather than 500. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof SolvaPayError && error.code === 'unauthorized'
}

export async function identifyRequest(
  header: (name: string) => string | null | undefined,
): Promise<RequestIdentity> {
  const authorization = header('authorization')?.trim()
  if (authorization && /^bearer\s+/i.test(authorization)) {
    const token = authorization.replace(/^bearer\s+/i, '').trim()
    const verified = await verifyBearerToken(token)
    if (!verified.ok) throw unauthorized(verified.reason)
    const { sub, email, name } = verified.payload
    if (typeof sub !== 'string' || sub.length === 0) {
      throw unauthorized('The bearer token has no subject (sub), so it names no user.')
    }
    return {
      kind: 'user',
      userId: sub,
      ...(typeof email === 'string' ? { email } : {}),
      ...(typeof name === 'string' ? { name } : {}),
    }
  }

  const customerRef = header(CUSTOMER_REF_HEADER)?.trim()
  if (customerRef) {
    const trustGateway = readEnv('SOLVAPAY_AUTH_TRUST_GATEWAY') === 'true'
    if (!trustGateway) throw unauthorized(UNTRUSTED_CUSTOMER_HEADER)
    if (readEnv('SOLVAPAY_AUTH_STRICT') === 'true') {
      throw unauthorized(
        'SOLVAPAY_AUTH_STRICT=true forbids trusting a gateway, but gateway trust is on. Turn one of them off.',
      )
    }
    return { kind: 'customer', customerRef }
  }

  return { kind: 'anonymous' }
}

/** The ref a handler sees before the customer is resolved; for logs and `getCustomerRef` callers. */
export function identityLabel(identity: RequestIdentity): string {
  if (identity.kind === 'customer') return identity.customerRef
  if (identity.kind === 'user') return identity.userId
  return 'anonymous'
}
