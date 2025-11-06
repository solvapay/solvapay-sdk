import { createSupabaseAuthMiddleware } from '@solvapay/next';

/**
 * Next.js Middleware for Authentication
 * 
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 */

export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};

