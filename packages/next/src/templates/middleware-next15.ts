/**
 * Next.js 15 Middleware Template
 *
 * This template is for Next.js 15 projects.
 * Place this file at the project root as `middleware.ts`
 *
 * For Next.js 16 projects with src/ folder structure, use middleware-next16.ts instead
 */

import { createSupabaseAuthMiddleware } from '@solvapay/next'

/**
 * Next.js Middleware for Authentication
 *
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 */

export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'], // Add any public routes here
})

export const config = {
  matcher: ['/api/:path*'],
}
