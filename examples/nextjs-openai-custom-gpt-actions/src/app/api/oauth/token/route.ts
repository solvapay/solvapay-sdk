import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { refreshTokens } from '@/lib/oauth-storage';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const grantType = formData.get('grant_type') as string;
  const code = formData.get('code') as string;
  const redirectUri = formData.get('redirect_uri') as string;
  const clientId = formData.get('client_id') as string;
  // Note: client_secret is accepted but not validated in this implementation
  formData.get('client_secret'); // Accept but don't validate

  if (!grantType || grantType !== 'authorization_code') {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Only authorization_code grant type is supported' },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing authorization code' },
      { status: 400 }
    );
  }

  if (!clientId) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing client_id' },
      { status: 400 }
    );
  }

  try {
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const { payload } = await jwtVerify(code, jwtSecret);

    if (payload.type !== 'authorization_code') {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid authorization code' },
        { status: 400 }
      );
    }

    const authCodeData = {
      userId: payload.userId as string,
      clientId: payload.clientId as string,
      redirectUri: payload.redirectUri as string,
      scopes: payload.scopes as string[],
    };

    if (authCodeData.redirectUri !== redirectUri) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Redirect URI mismatch' },
        { status: 400 }
      );
    }

    const expectedClientId = process.env.OAUTH_CLIENT_ID || 'solvapay-demo-client';
    if (clientId !== expectedClientId || authCodeData.clientId !== expectedClientId) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials' },
        { status: 400 }
      );
    }

    const issuer = process.env.OAUTH_ISSUER!;
    
    const accessToken = await new SignJWT({
      sub: authCodeData.userId,
      iss: issuer,
      aud: clientId,
      scope: authCodeData.scopes.join(' ')
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'demo-key' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(jwtSecret);

    const refreshToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    await refreshTokens.set(refreshToken, {
      userId: authCodeData.userId,
      clientId,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: authCodeData.scopes.join(' ')
    });
  } catch (error: any) {
    console.error('Token exchange error:', error);
    
    if (error.name === 'JWTExpired' || error.name === 'JWTInvalid') {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error during token exchange' },
      { status: 500 }
    );
  }
}
