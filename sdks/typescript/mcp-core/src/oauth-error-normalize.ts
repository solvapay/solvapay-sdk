/**
 * RFC 6749 token-error normalisation. Document bodies come from the
 * Rust `mcpNormalizeOauthError` op.
 */

import { callMcpSyncOp } from './native-mcp'

export type OAuthTokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'access_denied'

export const VALID_OAUTH_TOKEN_ERROR_CODES = new Set<string>([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'access_denied',
])

export interface OAuthErrorBody {
  error: OAuthTokenErrorCode | string
  error_description?: string
  [key: string]: unknown
}

export function hasOAuthErrorShape(body: unknown): body is OAuthErrorBody {
  if (body === null || typeof body !== 'object') return false
  const err = (body as Record<string, unknown>).error
  return typeof err === 'string' && VALID_OAUTH_TOKEN_ERROR_CODES.has(err)
}

function extractZodErrors(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const errs = body.errors
  if (!Array.isArray(errs)) return []
  return errs.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
}

export function deriveOAuthErrorCode(
  status: number,
  nestBody: Record<string, unknown>,
): OAuthTokenErrorCode {
  if (status === 401 || status === 403) return 'invalid_client'
  if (status >= 500) return 'server_error'

  const zodErrors = extractZodErrors(nestBody)
  const touches = (field: string): boolean =>
    zodErrors.some(e => {
      const path = (e as { path?: unknown }).path
      return Array.isArray(path) && path.includes(field)
    })

  if (touches('grant_type')) {
    const grantTypeErr = zodErrors.find(e => {
      const path = (e as { path?: unknown }).path
      return Array.isArray(path) && path.includes('grant_type')
    })
    const received = grantTypeErr && (grantTypeErr as { received?: unknown }).received
    if (received !== 'undefined' && received !== undefined && received !== '') {
      return 'unsupported_grant_type'
    }
    return 'invalid_request'
  }
  if (touches('code') || touches('refresh_token')) return 'invalid_grant'
  if (touches('scope')) return 'invalid_scope'
  if (touches('client_id') || touches('client_secret')) return 'invalid_client'
  return 'invalid_request'
}

export function buildErrorDescription(nestBody: Record<string, unknown>): string | undefined {
  const zodErrors = extractZodErrors(nestBody)
  if (zodErrors.length > 0) {
    const parts = zodErrors
      .map(e => {
        const path = (e as { path?: unknown }).path
        const message = (e as { message?: unknown }).message
        const pathStr = Array.isArray(path) ? path.filter(p => typeof p === 'string').join('.') : ''
        const msgStr = typeof message === 'string' ? message : ''
        if (pathStr && msgStr) return `${pathStr}: ${msgStr}`
        return pathStr || msgStr
      })
      .filter(Boolean)
    if (parts.length > 0) return parts.join('; ')
  }

  const message = nestBody.message
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    const strings = message.filter((m: unknown): m is string => typeof m === 'string')
    if (strings.length > 0) return strings.join('; ')
  }

  return undefined
}

export function toOAuthErrorBody(body: unknown, text: string, status: number): OAuthErrorBody {
  return callMcpSyncOp('mcpNormalizeOauthError', { body: body ?? null, text, status })
}
