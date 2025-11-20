import { createSupabaseAuthMiddleware } from '@solvapay/next'
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const authMiddleware = createSupabaseAuthMiddleware({
  // Public routes that don't require authentication
  publicRoutes: [
    '/api/docs/json', 
    '/api/docs', 
    '/api/config/url', 
    '/api/oauth/authorize', // OAuth endpoints must be public (handle their own auth)
    '/api/oauth/token',
    '/api/.well-known/openid-configuration',
    '/api/auth/session', // Session management endpoint (used during login flow)
    '/login', // Login page
    '/signup', // Sign up page
    '/api/gpt-auth/me',
    '/api/gpt-auth/start-signin',
    '/api/gpt-auth/signout'
  ],
})

export async function middleware(request: NextRequest) {
  // Handle CORS preflight for OpenAI Custom GPT Actions
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gpt-user-id',
      },
    })
  }

  // Check for Custom OAuth Token (Bearer)
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1]
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!)
      
      const { payload } = await jwtVerify(token, jwtSecret)
      
      // Token is valid!
      // Add user info to headers for downstream API routes to use
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-user-id', payload.sub as string)
      if (payload.email) {
        requestHeaders.set('x-user-email', payload.email as string)
      }
      
      // Explicitly add CORS headers to the success response to ensure they are present
      // even if next.config.js fails or is bypassed for some reason
      const response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      })
      
      response.headers.set('Access-Control-Allow-Origin', '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gpt-user-id')
      
      return response
    } catch (error) {
      // Invalid token
      console.error('Invalid OAuth token:', error)
      return new NextResponse(
        JSON.stringify({ error: 'invalid_token', message: 'Invalid or expired token' }),
        { 
          status: 401, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gpt-user-id',
          } 
        }
      )
    }
  }

  // Fallback to Standard Supabase Auth (Cookies)
  return authMiddleware(request as any)
}

export const config = {
  // Match all API routes and login page
  matcher: ['/api/:path*', '/login'],
}
