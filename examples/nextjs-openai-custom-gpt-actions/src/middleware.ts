import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SolvapayAuthAdapter } from '@solvapay/auth'

const adapter = new SolvapayAuthAdapter({
  apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL || 'https://api.solvapay.com',
})

const PUBLIC_PATHS = [
  '/api/docs',
  '/api/config/url',
]

export async function middleware(request: NextRequest) {
  // 1. Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gpt-user-id, x-user-id',
      },
    })
  }

  const { pathname } = request.nextUrl

  // 2. Skip static assets and public paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') || // files
    PUBLIC_PATHS.some(path => pathname.startsWith(path))
  ) {
    return NextResponse.next()
  }

  // 3. Extract Token (Bearer Header OR Cookie)
  let token = request.cookies.get('solvapay_token')?.value
  const authHeader = request.headers.get('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  }

  // 4. Validate Token & Get User ID
  let userId: string | null = null

  if (token) {
    // Adapter expects an object with headers.get()
    userId = await adapter.getUserIdFromRequest({
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'authorization') {
            return `Bearer ${token}`
          }
          return null
        }
      }
    })
  }

  // 5. Handle Auth Result
  
  // If we have a user ID, set the header and proceed
  if (userId) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', userId)
    
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
    
    // Add CORS headers to response
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gpt-user-id, x-user-id')
    
    return response
  }

  // If no user ID:
  
  // A) For API routes: Return 401
  if (pathname.startsWith('/api')) {
    return new NextResponse(
      JSON.stringify({ error: 'unauthorized', message: 'Authentication required' }),
      { 
        status: 401, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    )
  }

  // B) For Page routes (e.g. /):
  // If it's the landing page ('/'), we allow it
  if (pathname === '/') {
    return NextResponse.next()
  }

  // C) For other protected pages: Return 401
  // Since OAuth is handled by a separate frontend, we don't redirect to login
  return new NextResponse(
    JSON.stringify({ error: 'unauthorized', message: 'Authentication required' }),
    { 
      status: 401, 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      } 
    }
  )
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
