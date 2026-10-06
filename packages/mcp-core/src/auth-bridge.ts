/**
 * Build an MCP `authInfo` envelope from a bearer token. Populates
 * `authInfo.extra.customer_ref` so downstream `getCustomerRef` extractors
 * (adapter + descriptor handlers) can read the caller identity without
 * re-parsing the token.
 *
 * Two entry points share one envelope builder (`toAuthInfo`):
 *
 * - `buildAuthInfoFromBearer` — SolvaPay-issued tokens. Decodes the JWT
 *   payload **without verifying it** and reads `customer_ref` / `sub`.
 * - `buildAuthInfoFromVerifiedBearer` — tokens an external authorization
 *   server (Auth0, Clerk, Supabase, any OIDC issuer) minted and a
 *   `verifyToken` hook has already checked. Takes the verifier's
 *   {@link VerifiedBearer} result instead of re-reading the token.
 *
 * The transport decides where this envelope lands on the tool-handler
 * context: the official SDK v2 nests it at `extra.http.authInfo`, v1
 * exposed it flat at `extra.authInfo`. `defaultGetCustomerRef` reads
 * both.
 */

import {
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromJwtPayload,
  type McpBearerCustomerRefOptions,
} from './bearer'
import type { McpAuthInfo } from './types'

type JwtPayload = Record<string, unknown>

/**
 * Result of verifying a bearer token against its issuer. Produced by a
 * `verifyToken(token, req)` hook (for example `createJwksBearerVerifier`
 * in `@solvapay/auth`) and consumed by {@link buildAuthInfoFromVerifiedBearer}.
 *
 * `subject` is the issuer's stable user identifier (`sub`). When it is not
 * a SolvaPay `cus_` reference, the fetch factory bridges it to a SolvaPay
 * customer via `ensureCustomer(subject, subject, …)` and sets `customerRef`.
 * `email` is only forwarded to that bridge when `emailVerified === true`.
 */
export interface VerifiedBearer {
  subject: string
  /** SolvaPay `cus_` reference, when the verifier (or the bridge) already resolved it. */
  customerRef?: string
  email?: string
  emailVerified?: boolean
  name?: string
  clientId?: string
  scopes?: string[]
  /** Unix seconds. */
  expiresAt?: number
  /** The audience the token was bound to (the canonical MCP URL). */
  resource?: string
  /** The verified claims set, for extractors that need issuer-specific fields. */
  claims?: Record<string, unknown>
}

export interface BuildAuthInfoFromBearerOptions extends McpBearerCustomerRefOptions {
  clientId?: string
  defaultScopes?: string[]
  includePayload?: boolean
}

/** Fields `toAuthInfo` needs beyond the raw token. */
export interface AuthInfoFields {
  customerRef: string
  clientId?: string
  scopes?: string[]
  expiresAt?: number
  resource?: string
  payload?: JwtPayload
}

/**
 * `clientId` the envelope carries when neither the token nor the caller
 * names one. The official SDK's `AuthInfo.clientId` is required, and a
 * SolvaPay-issued token has no client identity of its own.
 */
export const DEFAULT_MCP_CLIENT_ID = 'solvapay-mcp-client'

function getClientId(payload: JwtPayload, explicitClientId?: string): string | undefined {
  if (explicitClientId) return explicitClientId

  if (typeof payload.client_id === 'string' && payload.client_id) return payload.client_id
  if (typeof payload.azp === 'string' && payload.azp) return payload.azp
  return undefined
}

function getResource(payload: JwtPayload): string | undefined {
  if (typeof payload.resource === 'string' && payload.resource) return payload.resource
  if (typeof payload.aud === 'string' && payload.aud) return payload.aud
  return undefined
}

function getScopes(payload: JwtPayload, defaultScopes: string[]): string[] {
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === 'string')
  }

  if (typeof payload.scope === 'string' && payload.scope.trim()) {
    return payload.scope
      .split(/\s+/)
      .map(scope => scope.trim())
      .filter(Boolean)
  }

  return defaultScopes
}

function getExpiresAt(payload: JwtPayload): number | undefined {
  return typeof payload.exp === 'number' ? payload.exp : undefined
}

/**
 * The single `authInfo` envelope builder. Both bearer paths funnel through
 * here so the shape downstream extractors read is identical regardless of
 * who verified the token.
 */
export function toAuthInfo(token: string, fields: AuthInfoFields): McpAuthInfo {
  const { customerRef, clientId, scopes, expiresAt, resource, payload } = fields
  return {
    token,
    clientId: clientId ?? DEFAULT_MCP_CLIENT_ID,
    scopes: scopes ?? [],
    expiresAt,
    extra: {
      customer_ref: customerRef,
      ...(resource ? { resource } : {}),
      ...(payload ? { payload } : {}),
    },
  }
}

/**
 * SolvaPay-mode envelope: decode the JWT payload (no signature check) and
 * read the customer reference from `customerRef` / `customer_ref` / `sub`.
 * Returns `null` when the header carries no bearer token; throws
 * `McpBearerAuthError` when the token is malformed or has no customer claim.
 */
export function buildAuthInfoFromBearer(
  authorization?: string | null,
  options: BuildAuthInfoFromBearerOptions = {},
): McpAuthInfo | null {
  const token = extractBearerToken(authorization)
  if (!token) return null

  const payload = decodeJwtPayload(token)
  return toAuthInfo(token, {
    customerRef: getCustomerRefFromJwtPayload(payload, options),
    clientId: getClientId(payload, options.clientId),
    scopes: getScopes(payload, options.defaultScopes ?? []),
    expiresAt: getExpiresAt(payload),
    resource: getResource(payload),
    ...(options.includePayload ? { payload } : {}),
  })
}

/**
 * External-mode envelope: the token was already verified by a `verifyToken`
 * hook, so every field comes from its {@link VerifiedBearer} result.
 * `customer_ref` is `verified.customerRef` when the bridge resolved one,
 * otherwise the issuer `subject`.
 */
export function buildAuthInfoFromVerifiedBearer(
  token: string,
  verified: VerifiedBearer,
): McpAuthInfo {
  return toAuthInfo(token, {
    customerRef: verified.customerRef ?? verified.subject,
    clientId: verified.clientId,
    scopes: verified.scopes,
    expiresAt: verified.expiresAt,
    resource: verified.resource,
    payload: verified.claims,
  })
}
