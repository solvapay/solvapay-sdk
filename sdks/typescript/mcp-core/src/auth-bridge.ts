/**
 * Build an MCP `authInfo` envelope from a verified `Authorization: Bearer`
 * JWT. Populates `authInfo.extra.customer_ref` so downstream
 * `getCustomerRef` extractors can read the caller identity.
 */

import { extractBearerToken, verifyBearer, type McpVerifyBearerOptions } from './bearer'
import type { McpToolExtra } from './types'

type JwtPayload = Record<string, unknown>

export type McpAuthInfoExtras = {
  clientId?: string
  defaultScopes?: string[]
  includePayload?: boolean
}

export interface BuildAuthInfoFromBearerOptions extends McpVerifyBearerOptions, McpAuthInfoExtras {}

function getClientId(payload: JwtPayload, explicitClientId?: string): string {
  if (explicitClientId) return explicitClientId

  const payloadClientId =
    (typeof payload.client_id === 'string' && payload.client_id) ||
    (typeof payload.azp === 'string' && payload.azp) ||
    null

  return payloadClientId || 'solvapay-mcp-client'
}

function getResource(payload: JwtPayload): string | undefined {
  if (typeof payload.resource === 'string' && payload.resource) return payload.resource
  if (typeof payload.aud === 'string' && payload.aud) return payload.aud
  return undefined
}

function getScopes(payload: JwtPayload, defaultScopes: string[]): string[] {
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter(scope => typeof scope === 'string') as string[]
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

export function buildAuthInfoFromBearer(
  authorization: string | null | undefined,
  options: BuildAuthInfoFromBearerOptions,
): McpToolExtra['authInfo'] | null {
  const token = extractBearerToken(authorization)
  if (!token) return null

  const verified = verifyBearer(token, options)
  if (verified.kind !== 'ok') {
    return null
  }
  const payload = verified.claims
  const clientId = getClientId(payload, options.clientId)
  const scopes = getScopes(payload, options.defaultScopes || [])
  const expiresAt = getExpiresAt(payload)
  const resource = getResource(payload)

  return {
    token,
    clientId,
    scopes,
    expiresAt,
    extra: {
      customer_ref: verified.customerRef,
      ...(resource ? { resource } : {}),
      ...(options.includePayload ? { payload } : {}),
    },
  }
}
