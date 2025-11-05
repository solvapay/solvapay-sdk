/**
 * Next.js 16 Middleware/Proxy Template
 * 
 * This template is for Next.js 16 projects that use the src/ folder structure.
 * Place this file in the src/ folder as either:
 * - `src/proxy.ts` (recommended for Next.js 16)
 * - `src/middleware.ts` (works but shows deprecation warning)
 * 
 * Next.js 16 renamed "middleware" to "proxy" - both exports work, but `proxy` is preferred.
 * 
 * For Next.js 15 projects, use middleware-next15.ts at the project root instead.
 */

import { createSupabaseAuthMiddleware } from '@solvapay/next';

/**
 * Next.js Proxy for Authentication (Next.js 16)
 * 
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 * 
 * Note: Next.js 16 renamed "middleware" to "proxy". You can export either:
 * - `export const proxy` (recommended, no deprecation warning)
 * - `export const middleware` (works but shows deprecation warning)
 */

// Recommended: Use 'proxy' export for Next.js 16 (no deprecation warning)
export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'], // Add any public routes here
});

// Alternative: Use 'middleware' export (works but shows deprecation warning in Next.js 16)
// Uncomment the line below and comment out the 'proxy' export above if you prefer:
// export const middleware = createSupabaseAuthMiddleware({
//   publicRoutes: ['/api/list-plans'],
// });

export const config = {
  matcher: ['/api/:path*'],
};

