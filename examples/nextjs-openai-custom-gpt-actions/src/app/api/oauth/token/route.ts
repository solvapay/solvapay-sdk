import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { refreshTokens } from '@/lib/oauth-storage';

/**
 * OAuth Token Exchange Endpoint
 * 
 * Exchanges authorization code (JWT) for access token.
 * Uses Supabase user IDs from JWT-encoded authorization codes.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const grantType = formData.get('grant_type') as string;
  const code = formData.get('code') as string;
  const redirectUri = formData.get('redirect_uri') as string;
  const clientId = formData.get('client_id') as string;
  const clientSecret = formData.get('client_secret') as string;

  console.log('🔍 [TOKEN DEBUG] Token exchange request:', {
    grantType,
    code: code ? `${code.substring(0, 20)}...` : 'missing',
    redirectUri,
    clientId,
    clientSecret: clientSecret ? '***' : 'missing'
  });

  // Validate required parameters
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
    // Verify and decode JWT authorization code
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const { payload } = await jwtVerify(code, jwtSecret);

    // Validate authorization code type
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

    // Validate redirect URI matches
    if (authCodeData.redirectUri !== redirectUri) {
      console.log('🔍 [TOKEN DEBUG] Redirect URI mismatch');
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Redirect URI mismatch' },
        { status: 400 }
      );
    }

    // Validate client
    const expectedClientId = process.env.OAUTH_CLIENT_ID || 'solvapay-demo-client';
    if (clientId !== expectedClientId || authCodeData.clientId !== expectedClientId) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials' },
        { status: 400 }
      );
    }

    // Generate JWT access token using Supabase user ID
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

    // Generate refresh token
    const refreshToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Store refresh token in Supabase database
    await refreshTokens.set(refreshToken, {
      userId: authCodeData.userId,
      clientId,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });

    console.log('✅ [TOKEN] Generated JWT tokens for client:', clientId, 'user:', authCodeData.userId);

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600, // 1 hour
      refresh_token: refreshToken,
      scope: authCodeData.scopes.join(' ')
    });
  } catch (error: any) {
    console.error('Token exchange error:', error);
    
    // Handle JWT verification errors
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
