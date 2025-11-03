import { NextRequest, NextResponse } from 'next/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

/**
 * Next.js Middleware for Authentication
 * 
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 * 
 * Alternative: You can also use SupabaseAuthAdapter directly in individual routes
 * (see comments in API routes for examples).
 */

// Lazy initialization of auth adapter (Edge runtime compatible)
let auth: SupabaseAuthAdapter | null = null;

function getAuthAdapter(): SupabaseAuthAdapter {
  if (!auth) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    
    if (!jwtSecret) {
      throw new Error(
        'SUPABASE_JWT_SECRET environment variable is required. ' +
        'Please set it in your .env.local file. ' +
        'Get it from: Supabase Dashboard → Settings → API → JWT Secret'
      );
    }
    
    auth = new SupabaseAuthAdapter({ jwtSecret });
  }
  
  return auth;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only process API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Public routes that don't require authentication
  const publicRoutes: string[] = [];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // Initialize auth adapter (with error handling)
  let authAdapter: SupabaseAuthAdapter;
  try {
    authAdapter = getAuthAdapter();
  } catch (error) {
    console.error('Auth adapter initialization failed:', error);
    return NextResponse.json(
      { 
        error: 'Server configuration error', 
        details: error instanceof Error ? error.message : 'Authentication not configured'
      },
      { status: 500 }
    );
  }

  // Extract userId from Supabase JWT token (if present)
  const userId = await authAdapter.getUserIdFromRequest(request);

  // For public routes, allow access even without auth, but still set userId if available
  if (isPublicRoute) {
    const requestHeaders = new Headers(request.headers);
    if (userId) {
      requestHeaders.set('x-user-id', userId);
    }
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // For protected routes, require authentication
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', details: 'Valid authentication required' },
      { status: 401 }
    );
  }

  // Clone request headers and add userId for downstream routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);

  // Optionally add email if available from token
  // (You can extend SupabaseAuthAdapter to return email as well)
  
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/api/:path*'],
};

