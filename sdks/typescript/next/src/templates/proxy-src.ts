/**
 * Next.js Proxy Template
 *
 * This template is for Next.js 16 projects that use the src/ folder structure.
 * Place this file in the src/ folder as `src/proxy.ts`.
 *
 * For projects without a src/ folder, use proxy-root.ts at the project root instead.
 */

import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'

/**
 * Next.js Proxy for Authentication
 *
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 *
 * Next.js uses the `proxy` export for edge request handling.
 */

export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'], // Add any public routes here
})

export const config = {
  matcher: ['/api/:path*'],
}
