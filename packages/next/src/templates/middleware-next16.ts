/**
 * Next.js 16 Middleware/Proxy Template
 *
 * This template is for Next.js 16 projects that use the src/ folder structure.
 * Place this file in the src/ folder as `src/proxy.ts`.
 *
 * Next.js 16 renamed "middleware" to "proxy".
 *
 * For Next.js 15 projects, use middleware-next15.ts at the project root instead.
 */

import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'

/**
 * Next.js Proxy for Authentication (Next.js 16)
 *
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 *
 * Note: Next.js 16 uses the `proxy` export.
 */

// Recommended: Use 'proxy' export for Next.js 16 (no deprecation warning)
export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'], // Add any public routes here
})

export const config = {
  matcher: ['/api/:path*'],
}
