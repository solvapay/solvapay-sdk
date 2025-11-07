import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { refreshTokens } from '@/lib/oauth-storage';

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

    try {
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
      await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!
      });

      console.log('✅ [REVOKE] Access token will expire naturally (no blacklist storage)');
      
      return NextResponse.json({
        revoked: true,
        message: 'Token revocation completed'
      });
    } catch (jwtError: any) {
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
