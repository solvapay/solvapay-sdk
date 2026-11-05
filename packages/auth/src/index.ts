/**
 * @solvapay/auth
 *
 * Authentication adapters for extracting user IDs from requests, plus the
 * generic JWKS bearer verifier for MCPs behind a third-party OIDC issuer.
 * Provider-specific presets live on subpaths (`@solvapay/auth/auth0`,
 * `@solvapay/auth/supabase`).
 */

// Export the interface
export type { AuthAdapter, AuthRequestHandleResult, RequestLike, ServerIdentity } from './adapter'

export { SOLVAPAY_AUTHORIZATION_HEADER, SOLVAPAY_USER_ID_HEADER } from './constants'

// Export mock adapter (no dependencies)
export { MockAuthAdapter } from './mock'
export type { MockAuthAdapter as MockAuthAdapterType } from './mock'

// Export SolvaPay adapter and client
export { SolvapayAuthAdapter, SolvapayOAuthClient } from './solvapay'
export type { SolvapayAuthAdapterConfig, SolvapayOAuthConfig, TokenResponse } from './solvapay'

// Export Next.js route utilities
export {
  getUserIdFromRequest,
  requireUserId,
  getUserEmailFromRequest,
  getUserNameFromRequest,
} from './next-utils'

// Generic JWKS bearer verifier (any OIDC issuer). Presets: ./auth0
export { createJwksBearerVerifier } from './jwks-bearer'
export type {
  BearerProfileClaims,
  BearerTokenVerifier,
  JwksBearerVerifierOptions,
  VerifiedBearer,
} from './jwks-bearer'

// Note: SupabaseAuthAdapter is exported from ./supabase.ts directly
// Users import it via: import { SupabaseAuthAdapter } from '@solvapay/auth/supabase'
// This keeps the main export lean if users don't need Supabase
