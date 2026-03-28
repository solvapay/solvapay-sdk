/**
 * Edge-safe middleware exports for Next.js middleware/proxy files.
 *
 * Import from `@solvapay/next/middleware` inside middleware/proxy to avoid
 * pulling in route helpers that depend on Node-only runtime APIs.
 */
export { createAuthMiddleware, createSupabaseAuthMiddleware } from './helpers/middleware'
export type { AuthMiddlewareOptions, SupabaseAuthMiddlewareOptions } from './helpers/middleware'
