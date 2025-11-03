import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Debug Current User Endpoint
 * 
 * Returns information about the currently authenticated user.
 * Supports both Supabase auth (from middleware) and OAuth tokens.
 */
export async function GET(request: NextRequest) {
  // First, try to get user ID from middleware (Supabase auth)
  const userIdFromHeader = request.headers.get('x-user-id');
  
  if (userIdFromHeader) {
    return NextResponse.json({ 
      success: true, 
      userId: userIdFromHeader, 
      source: 'middleware' 
    });
  }

  // Fallback: try OAuth token
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({
      error: 'No Authorization header found',
      headers: Object.fromEntries(request.headers.entries())
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const { payload } = await jwtVerify(token, jwtSecret, {
      issuer: process.env.OAUTH_ISSUER!,
      audience: process.env.OAUTH_CLIENT_ID || 'test-client-id'
    });

    return NextResponse.json({
      success: true,
      userId: payload.sub,
      payload: payload,
      source: 'oauth_token'
    });
  } catch (error) {
    return NextResponse.json({
      error: 'JWT verification failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
