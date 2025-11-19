import { createSupabaseAuthMiddleware } from '@solvapay/next'
import { NextRequest, NextResponse } from 'next/server'

const authMiddleware = createSupabaseAuthMiddleware({
  // Public routes that don't require authentication
  publicRoutes: ['/api/docs/json'],
})

export async function middleware(request: NextRequest) {
  // Handle CORS preflight for OpenAI Custom GPT Actions
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  return authMiddleware(request)
}

export const config = {
  matcher: ['/api/:path*'],
}
