/**
 * Shared OAuth token-error normalisation helpers for the parallel
 * `@solvapay/mcp/fetch` and `@solvapay/mcp/express` adapter bridges.
 *
 * Both bridges proxy the same upstream SolvaPay `/v1/customer/auth/{token,revoke}`
 * endpoints, so they share the same requirement: surface RFC 6749
 * §5.2 + §4.1.2.1 compliant error bodies to MCP OAuth clients, while
 * tolerating NestJS' default exception-filter shape (`{ error, message,
 * statusCode }`) on the upstream side.
 *
 * Exporting these from a single internal module eliminates the
 * drift risk that surfaced during the CSP + OAuth-normalizer patch:
 * the fetch bridge's gate was tightened to check against
 * `VALID_OAUTH_TOKEN_ERROR_CODES` without the sibling express copy
 * being updated, which Bugbot caught on PR #137. Keeping the module
 * under `mcp/src/internal/` (rather than `@solvapay/mcp-core`)
 * respects the architectural rule that mcp-core stays framework-neutral
 * — the OAuth bridge middleware is an adapter-package concern.
 */

/**
 * RFC 6749 §5.2 valid error codes for the token endpoint. §4.1.2.1
 * adds `server_error`, `temporarily_unavailable`, and `access_denied`,
 * which authorization servers may also emit from the token endpoint in
 * practice. Revocation (RFC 7009 §2.2.1) accepts the first two plus
 * `unsupported_token_type`, which we never synthesise — an HTTP 400
 * without a recognisable mapping always lands on `invalid_request`
 * regardless of endpoint.
 */
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

/**
 * Runtime allow-list of RFC 6749 token + authorization error codes. An
 * upstream body whose `error` field is in this set is trusted and
 * proxied verbatim; anything else (e.g. NestJS's literal
 * `"Unauthorized"` / `"Forbidden"` labels) falls through to
 * `deriveOAuthErrorCode` for mapping.
 */
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

/**
 * Narrow an unknown upstream body to `OAuthErrorBody` when its `error`
 * field is a known RFC 6749 code. Callers treat a `true` return as
 * "pass the body through verbatim"; on `false` the body is handed to
 * `toOAuthErrorBody` for mapping.
 */
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

/**
 * Map an upstream HTTP status + NestJS-shaped body to the closest
 * RFC 6749 error code. Status-based mapping comes first (401/403 →
 * `invalid_client`, 5xx → `server_error`), then Zod-validation-path
 * inspection.
 */
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

/**
 * Produce an `error_description` string for a NestJS-shaped upstream
 * body. Prefers the Zod-validation summary (`path: message; ...`) when
 * present, falling back to the NestJS `message` field. Returns
 * `undefined` when no human-readable description can be synthesised.
 */
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

/**
 * Normalise any upstream body shape into an RFC 6749 `OAuthErrorBody`.
 * Already-compliant bodies (whose `error` is in
 * `VALID_OAUTH_TOKEN_ERROR_CODES`) pass through verbatim; NestJS /
 * arbitrary JSON / plain-text bodies are mapped via
 * `deriveOAuthErrorCode` + `buildErrorDescription`.
 */
export function toOAuthErrorBody(body: unknown, text: string, status: number): OAuthErrorBody {
  if (hasOAuthErrorShape(body)) return body

  if (body && typeof body === 'object') {
    const nestBody = body as Record<string, unknown>
    const error = deriveOAuthErrorCode(status, nestBody)
    const error_description = buildErrorDescription(nestBody)
    return error_description ? { error, error_description } : { error }
  }

  const fallbackError: OAuthTokenErrorCode = status >= 500 ? 'server_error' : 'invalid_request'
  const description =
    typeof text === 'string' && text.length > 0 && text.length < 500 ? text : undefined
  return description
    ? { error: fallbackError, error_description: description }
    : { error: fallbackError }
}
