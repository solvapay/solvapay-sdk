import { NextRequest, NextResponse } from 'next/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

/**
 * Next.js Middleware for Authentication
 * 
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 * 
 * Also handles OAuth route rewriting for OpenAI Custom GPT Actions compatibility.
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

  // Rewrite OAuth routes to API routes (for OpenAI Custom GPT Actions compatibility)
  if (pathname.startsWith('/oauth/')) {
    const newUrl = request.nextUrl.clone();
    newUrl.pathname = `/api${pathname}`;
    console.log('🔄 [MIDDLEWARE] Rewriting OAuth route:', pathname, '→', newUrl.pathname);
    return NextResponse.rewrite(newUrl);
  }

  // Handle CORS
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Only process API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Public routes that don't require authentication
  const publicRoutes = ['/api/health', '/api/healthz', '/api/auth/signin-url'];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  // Initialize auth adapter (with error handling)
  let authAdapter: SupabaseAuthAdapter;
  try {
    authAdapter = getAuthAdapter();
  } catch (error) {
    console.error('Auth adapter initialization failed:', error);
    // For public routes, allow access even if auth is misconfigured
    if (isPublicRoute) {
      return NextResponse.next();
    }
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
    // Also support legacy x-customer-ref header for backward compatibility
    if (userId) {
      requestHeaders.set('x-customer-ref', userId);
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
  // Also support legacy x-customer-ref header for backward compatibility
  requestHeaders.set('x-customer-ref', userId);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/api/:path*', '/oauth/:path*'],
};
