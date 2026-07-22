import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'

/**
 * Edge proxy for Supabase JWT auth on /api/* routes.
 */
export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: [
    '/api/list-plans',
    '/api/merchant',
    '/api/get-product',
    // Next.js treats `_folder` as private (no route), so diag lives at /api/diag/*
    // (next.config rewrites /api/_diag/* → /api/diag/* for the plan's curl path).
    '/api/diag/impl',
    '/api/diag/impl-edge',
    '/api/_diag/impl',
    '/api/_diag/impl-edge',
  ],
})

export const config = {
  matcher: ['/api/:path*'],
}
