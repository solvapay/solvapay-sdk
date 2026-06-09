import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'

/**
 * Edge middleware for Supabase JWT auth on /api/* routes.
 *
 * Uses middleware.ts (not proxy.ts) so @opennextjs/cloudflare can bundle
 * for Cloudflare Workers — Node proxy middleware is not supported on OpenNext CF.
 */
export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans', '/api/merchant', '/api/get-product'],
})

export const config = {
  matcher: ['/api/:path*'],
}
