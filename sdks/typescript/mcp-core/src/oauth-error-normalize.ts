/**
 * RFC 6749 token-error normalisation. Bodies and inspect helpers come from
 * the Rust `mcpNormalizeOauthError` / `mcpOauthErrorInspect` ops.
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
  return callMcpSyncOp('mcpOauthErrorInspect', { kind: 'has-shape', body: body ?? null })
}

export function deriveOAuthErrorCode(
  status: number,
  nestBody: Record<string, unknown>,
): OAuthTokenErrorCode {
  return callMcpSyncOp('mcpOauthErrorInspect', {
    kind: 'derive-code',
    status,
    body: nestBody,
  })
}

export function buildErrorDescription(nestBody: Record<string, unknown>): string | undefined {
  const value = callMcpSyncOp<string | null>('mcpOauthErrorInspect', {
    kind: 'build-description',
    body: nestBody,
  })
  return value ?? undefined
}

export function toOAuthErrorBody(body: unknown, text: string, status: number): OAuthErrorBody {
  return callMcpSyncOp('mcpNormalizeOauthError', { body: body ?? null, text, status })
}
