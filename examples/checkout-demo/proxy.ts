import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'

/**
 * Edge proxy for Supabase JWT auth on /api/* routes.
 */
export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans', '/api/merchant', '/api/get-product'],
})

export const config = {
  matcher: ['/api/:path*'],
}
