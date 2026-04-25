/**
 * MCP OAuth bearer-token helper utilities.
 *
 * These helpers are intentionally lightweight and do not verify JWT
 * signatures. Use them after token validation (for example via
 * `/v1/customer/auth/userinfo`).
 */

export class McpBearerAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpBearerAuthError'
  }
}

export type McpBearerCustomerRefOptions = {
  claimPriority?: string[]
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function extractBearerToken(authorization?: string | null): string | null {
  if (!authorization) return null
  if (!authorization.startsWith('Bearer ')) return null
  return authorization.slice(7).trim() || null
}

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

export function getCustomerRefFromBearerAuthHeader(
  authorization?: string | null,
  options: McpBearerCustomerRefOptions = {},
): string {
  const token = extractBearerToken(authorization)
  if (!token) {
    throw new McpBearerAuthError('Missing bearer token')
  }
  const payload = decodeJwtPayload(token)
  return getCustomerRefFromJwtPayload(payload, options)
}
