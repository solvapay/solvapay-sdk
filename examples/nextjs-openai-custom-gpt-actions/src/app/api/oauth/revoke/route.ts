import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { refreshTokens } from '@/lib/oauth-storage';

/**
 * OAuth Token Revocation Endpoint
 * 
 * Revokes refresh tokens. Access tokens are automatically invalidated
 * after expiration (bare minimum approach - no blacklist needed).
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const token = formData.get('token') as string;
  const tokenTypeHint = formData.get('token_type_hint') as string;

  console.log('🔍 [REVOKE DEBUG] Token revocation request:', {
    tokenTypeHint,
    tokenLength: token?.length
  });

  if (!token) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing token parameter' },
      { status: 400 }
    );
  }

  try {
    // Check if it's a refresh token
    if (tokenTypeHint === 'refresh_token' || await refreshTokens.has(token)) {
      const refreshTokenData = await refreshTokens.get(token);
      if (refreshTokenData) {
        await refreshTokens.delete(token);
        console.log('✅ [REVOKE] Successfully revoked refresh token for user:', refreshTokenData.userId);
        
        return NextResponse.json({
          revoked: true,
          message: 'Refresh token successfully revoked'
        });
      }
    }

    // For access tokens, we rely on JWT expiration only (bare minimum approach)
    // We could verify the token is valid, but since JWTs expire in 1 hour,
    // we don't need a blacklist for this demo
    try {
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
      await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!
      });

      // Token is valid but we don't store revoked access tokens
      // They'll expire naturally in 1 hour
      console.log('✅ [REVOKE] Access token will expire naturally (no blacklist storage)');
      
      return NextResponse.json({
        revoked: true,
        message: 'Token revocation completed'
      });
    } catch (jwtError: any) {
      // Token is expired or invalid - consider it revoked
      // According to OAuth2 RFC 7009, the server should respond with 200 OK
      // even if the token was not found or already revoked
      return NextResponse.json({
        revoked: true,
        message: 'Token revocation completed'
      });
    }

  } catch (error) {
    console.error('Error in token revocation:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error during token revocation' },
      { status: 500 }
    );
  }
}
