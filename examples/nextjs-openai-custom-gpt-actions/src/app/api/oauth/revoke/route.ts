import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { revokedTokens, refreshTokens } from '@/lib/oauth-storage';

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
    // Check if it's a refresh token first
    if (tokenTypeHint === 'refresh_token' || refreshTokens.has(token)) {
      const refreshTokenData = refreshTokens.get(token);
      if (refreshTokenData) {
        refreshTokens.delete(token);
        console.log('✅ [REVOKE] Successfully revoked refresh token for user:', refreshTokenData.userId);
        
        return NextResponse.json({
          revoked: true,
          message: 'Refresh token successfully revoked'
        });
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
      
      console.log('✅ [REVOKE] Successfully revoked access token for user:', payload.sub);
      
      return NextResponse.json({
        revoked: true,
        message: 'Access token successfully revoked'
      });

    } catch (jwtError) {
      // Token is not a valid JWT, might be an invalid or expired token
      console.log('🔍 [REVOKE DEBUG] Token is not a valid JWT:', jwtError);
      
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
