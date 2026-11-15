/**
 * Verifies a customer's bearer token with SolvaPay before an MCP server
 * serves it. The customer is the one SolvaPay's userinfo names: a token's
 * own payload is never trusted for identity, since anyone can write one.
 */

import { SolvaPayError } from '@solvapay/core'
import { buildAuthInfoFromBearer, type BuildAuthInfoFromBearerOptions } from './auth-bridge'
import type { McpToolExtra } from './types'

export interface SolvaPayTokenVerifierOptions {
  /** SolvaPay API base URL, e.g. `https://api.solvapay.com`. */
  apiBaseUrl: string
  /** How long a valid answer is reused, in seconds (default 60). */
  cacheSeconds?: number
  /** At most this many answers are kept (default 1000). */
  maxEntries?: number
  fetchImpl?: typeof fetch
}

export interface VerifiedCustomer {
  customerRef: string
}

/** `null` for a token SolvaPay refuses; throws when SolvaPay can't answer. */
export type SolvaPayTokenVerifier = (token: string) => Promise<VerifiedCustomer | null>

export function createSolvaPayTokenVerifier(
  options: SolvaPayTokenVerifierOptions,
): SolvaPayTokenVerifier {
  const userinfo = `${options.apiBaseUrl.replace(/\/+$/, '')}/v1/customer/auth/userinfo`
  const ttlMs = (options.cacheSeconds ?? 60) * 1000
  const maxEntries = options.maxEntries ?? 1000
  const cache = new Map<string, { at: number; customer: VerifiedCustomer }>()

  return async token => {
    const cached = cache.get(token)
    if (cached && Date.now() - cached.at < ttlMs) return cached.customer

    const fetchImpl = options.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl(userinfo, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch (error) {
      throw new SolvaPayError(
        `Could not reach SolvaPay to verify the token: ${error instanceof Error ? error.message : String(error)}`,
        { code: 'network_error' },
      )
    }
    if (response.status === 401 || response.status === 403) {
      cache.delete(token)
      return null
    }
    if (response.status !== 200) {
      throw new SolvaPayError(`SolvaPay answered ${response.status} when verifying a token`, {
        code: 'token_verification_failed',
        status: response.status,
      })
    }
    let claims: { sub?: unknown } | null
    try {
      claims = (await response.json()) as { sub?: unknown } | null
    } catch {
      throw new SolvaPayError("SolvaPay's userinfo answer is not JSON", {
        code: 'token_verification_failed',
      })
    }
    const sub = claims?.sub
    if (typeof sub !== 'string' || !sub) {
      throw new SolvaPayError("SolvaPay's userinfo has no customer (sub)", {
        code: 'token_verification_failed',
      })
    }
    const customer = { customerRef: sub }
    cache.delete(token)
    cache.set(token, { at: Date.now(), customer })
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value as string
      cache.delete(oldest)
    }
    return customer
  }
}

/**
 * `authInfo` for a bearer token SolvaPay has verified, or `null` when there is
 * no token, it isn't a JWT naming a customer, or SolvaPay refuses it. The
 * customer comes from SolvaPay's answer. Throws when SolvaPay can't answer.
 */
export async function verifyAuthInfoFromBearer(
  authorization: string | null | undefined,
  verify: SolvaPayTokenVerifier,
  options: BuildAuthInfoFromBearerOptions = {},
): Promise<McpToolExtra['authInfo'] | null> {
  let unverified: McpToolExtra['authInfo'] | null
  try {
    unverified = buildAuthInfoFromBearer(authorization, options)
  } catch {
    return null
  }
  if (!unverified?.token) return null
  const customer = await verify(unverified.token)
  if (!customer) return null
  return {
    ...unverified,
    extra: { ...unverified.extra, customer_ref: customer.customerRef },
  }
}
