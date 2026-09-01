/**
 * MCP OAuth bearer helpers. Claim trust goes through Rust `mcpVerifyBearer`
 * (RS256/ES256 via JWKS, or an explicit HS256 secret). Unsigned decode is
 * not an auth path.
 */

import { callMcpSyncOp } from './native-mcp'

export class McpBearerAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpBearerAuthError'
  }
}

export type McpBearerCustomerRefOptions = {
  claimPriority?: string[]
}

export type McpVerifyBearerOptions = McpBearerCustomerRefOptions & {
  jwksJson?: unknown
  hs256Secret?: string
  expectedIssuer: string
  expectedAudience: string
  nowUnixSecs: number
}

export type McpVerifyBearerOk = {
  kind: 'ok'
  claims: Record<string, unknown>
  customerRef: string
}

export type McpVerifyBearerUnauthorized = {
  kind: 'unauthorized'
  status: number
  message: string
}

export type McpVerifyBearerResult = McpVerifyBearerOk | McpVerifyBearerUnauthorized

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Issuer/audience defaults matching Rust `mcp_auth_gate`. */
export function defaultMcpBearerExpectations(
  publicBaseUrl: string,
  mcpPath?: string | null,
  nowUnixSecs: number = Math.floor(Date.now() / 1000),
): Pick<McpVerifyBearerOptions, 'expectedIssuer' | 'expectedAudience' | 'nowUnixSecs'> {
  const issuer = publicBaseUrl.replace(/\/+$/, '')
  const raw = mcpPath?.trim() ?? ''
  const path = raw.replace(/\/+$/, '')
  const audience = path.length > 0 ? `${issuer}${path.startsWith('/') ? path : `/${path}`}` : issuer
  return { expectedIssuer: issuer, expectedAudience: audience, nowUnixSecs }
}

export function extractBearerToken(authorization?: string | null): string | null {
  if (!authorization) return null
  if (!authorization.startsWith('Bearer ')) return null
  return authorization.slice(7).trim() || null
}

/** Structural payload parse. Not an authorization check. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2) {
    throw new McpBearerAuthError('Invalid JWT format')
  }

  try {
    const payloadText = base64UrlDecode(parts[1])
    const payload = JSON.parse(payloadText) as Record<string, unknown>
    return payload
  } catch {
    throw new McpBearerAuthError('Invalid JWT payload')
  }
}

export function getCustomerRefFromJwtPayload(
  payload: Record<string, unknown>,
  options: McpBearerCustomerRefOptions = {},
): string {
  const claimPriority = options.claimPriority || ['customerRef', 'customer_ref', 'sub']

  for (const claim of claimPriority) {
    const value = payload[claim]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  throw new McpBearerAuthError(
    `No customer reference claim found (checked: ${claimPriority.join(', ')})`,
  )
}

export function verifyBearer(
  token: string,
  options: McpVerifyBearerOptions,
): McpVerifyBearerResult {
  return callMcpSyncOp('mcpVerifyBearer', {
    token,
    expectedIssuer: options.expectedIssuer,
    expectedAudience: options.expectedAudience,
    nowUnixSecs: options.nowUnixSecs,
    ...(options.jwksJson !== undefined ? { jwksJson: options.jwksJson } : {}),
    ...(options.hs256Secret !== undefined ? { hs256Secret: options.hs256Secret } : {}),
    ...(options.claimPriority !== undefined ? { claimPriority: options.claimPriority } : {}),
  })
}

export function getCustomerRefFromBearerAuthHeader(
  authorization: string | null | undefined,
  options: McpVerifyBearerOptions,
): string {
  const token = extractBearerToken(authorization)
  if (!token) {
    throw new McpBearerAuthError('Missing bearer token')
  }
  const result = verifyBearer(token, options)
  if (result.kind !== 'ok') {
    throw new McpBearerAuthError(result.message)
  }
  return result.customerRef
}
