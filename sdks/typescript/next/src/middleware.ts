/**
 * Edge-safe middleware exports for Next.js middleware/proxy files.
 *
 * Import from `@solvapay/next/middleware` inside middleware/proxy to avoid
 * pulling in route helpers that depend on Node-only runtime APIs.
 */
export {
  createAuth0AuthMiddleware,
  createAuthMiddleware,
  createSupabaseAuthMiddleware,
} from './helpers/middleware'
export type {
  Auth0AuthMiddlewareOptions,
  AuthMiddlewareOptions,
  SupabaseAuthMiddlewareOptions,
} from './helpers/middleware'
