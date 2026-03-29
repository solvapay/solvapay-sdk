import {
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromJwtPayload,
  type McpBearerCustomerRefOptions,
} from '../mcp-auth'
import type { McpToolExtra } from '../types'

type JwtPayload = Record<string, unknown>

export interface BuildAuthInfoFromBearerOptions extends McpBearerCustomerRefOptions {
  clientId?: string
  defaultScopes?: string[]
  includePayload?: boolean
}

function getClientId(payload: JwtPayload, explicitClientId?: string): string {
  if (explicitClientId) return explicitClientId

  const payloadClientId =
    (typeof payload.client_id === 'string' && payload.client_id) ||
    (typeof payload.azp === 'string' && payload.azp) ||
    (typeof payload.aud === 'string' && payload.aud) ||
    null

  return payloadClientId || 'solvapay-mcp-client'
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
  authorization?: string | null,
  options: BuildAuthInfoFromBearerOptions = {},
): McpToolExtra['authInfo'] | null {
  const token = extractBearerToken(authorization)
  if (!token) return null

  const payload = decodeJwtPayload(token)
  const customerRef = getCustomerRefFromJwtPayload(payload, options)
  const clientId = getClientId(payload, options.clientId)
  const scopes = getScopes(payload, options.defaultScopes || [])
  const expiresAt = getExpiresAt(payload)

  return {
    token,
    clientId,
    scopes,
    expiresAt,
    extra: {
      customer_ref: customerRef,
      ...(options.includePayload ? { payload } : {}),
    },
  }
}
