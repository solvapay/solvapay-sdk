import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { revokedTokens, refreshTokens } from '@/lib/oauth-storage';
import { SESSION_COOKIE_NAME } from '@/lib/session';

/**
 * Sign out endpoint that revokes the user's access token
 * Supports both Bearer token and form data token input
 */
export async function POST(request: NextRequest) {
  let token: string | null = null;
  let tokenTypeHint: string | null = null;

  // Try to get token from Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
    tokenTypeHint = 'access_token';
  } else {
    // Fall back to form data
    const formData = await request.formData();
    token = formData.get('token') as string;
    tokenTypeHint = formData.get('token_type_hint') as string;
  }

  // Sign out request received

  if (!token) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing token parameter' },
      { status: 400 }
    );
  }

  try {
    // Check if it's a refresh token first
    if (tokenTypeHint === 'refresh_token' || refreshTokens.has(token)) {
      const refreshTokenData = refreshTokens.get(token);
      if (refreshTokenData) {
        refreshTokens.delete(token);
        // Successfully signed out user via refresh token
        
        const res = NextResponse.json({
          success: true,
          message: 'Successfully signed out'
        });
        res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
        return res;
      }
    }

    // Try to verify it as a JWT access token
    try {
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
      const { payload } = await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!
      });

      // Add to revoked tokens blacklist
      revokedTokens.add(token);
      
      // Successfully signed out user via access token
      
      const res = NextResponse.json({
        success: true,
        message: 'Successfully signed out'
      });
      res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
      return res;

    } catch (jwtError) {
      // Token is not a valid JWT, might be an invalid or expired token
      // Token is not a valid JWT
      
      // Still return success for security reasons (don't leak token validity info)
      const res = NextResponse.json({
        success: true,
        message: 'Sign out completed'
      });
      res.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
      return res;
    }

  } catch (error) {
    console.error('Error during sign out:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error during sign out' },
      { status: 500 }
    );
  }
}
