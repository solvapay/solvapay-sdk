/**
 * Authentication helper — header/env plumbing plus the Rust
 * `resolveAuthenticatedUser` decision core.
 */

import type { AuthenticatedUser, ErrorResult } from './types'
import { SOLVAPAY_USER_ID_HEADER } from '@solvapay/auth'
import { handleRouteError } from './error'
import { resolveAuthenticatedUser } from '../native-decisions'

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.[name]
}

function isErrorResult(value: unknown): value is ErrorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    'status' in value &&
    typeof (value as ErrorResult).error === 'string' &&
    typeof (value as ErrorResult).status === 'number'
  )
}

/**
 * Extract authenticated user information from a standard Web API Request.
 *
 * Resolution order is owned by the Rust core (`resolveAuthenticatedUser`):
 * 1. `SOLVAPAY_USER_ID_HEADER` header
 * 2. `Authorization: Bearer <jwt>` (HS256 when a secret is configured)
 *
 * @since 1.0.0
 */
export async function getAuthenticatedUserCore(
  request: Request,
  options: {
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<AuthenticatedUser | ErrorResult> {
  try {
    const resolved = resolveAuthenticatedUser({
      headerUserId: request.headers.get(SOLVAPAY_USER_ID_HEADER),
      authorizationHeader: request.headers.get('authorization'),
      jwtSecret: readEnv('SOLVAPAY_JWT_SECRET') || readEnv('SUPABASE_JWT_SECRET') || null,
      strictMode: readEnv('SOLVAPAY_AUTH_STRICT') === 'true',
      includeEmail: options.includeEmail !== false,
      includeName: options.includeName !== false,
      nowUnixSecs: Math.floor(Date.now() / 1000),
    })
    if (isErrorResult(resolved)) {
      return resolved
    }
    return resolved as AuthenticatedUser
  } catch (error) {
    return handleRouteError(error, 'Get authenticated user', 'Authentication failed')
  }
}
