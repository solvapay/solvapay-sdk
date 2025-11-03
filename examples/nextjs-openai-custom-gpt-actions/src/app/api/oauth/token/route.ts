import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { authorizationCodes, refreshTokens } from '@/lib/oauth-storage';

/**
 * OAuth Token Exchange Endpoint
 * 
 * Exchanges authorization code for access token.
 * Uses Supabase user IDs from authorization codes generated in /auth/callback.
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
    code,
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

  // Validate authorization code
  const authCodeData = authorizationCodes.get(code);
  if (!authCodeData || authCodeData.expiresAt < new Date()) {
    console.log('🔍 [TOKEN DEBUG] Invalid or expired authorization code');
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' },
      { status: 400 }
    );
  }

  if (authCodeData.redirectUri !== redirectUri) {
    console.log('🔍 [TOKEN DEBUG] Redirect URI mismatch');
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Redirect URI mismatch' },
      { status: 400 }
    );
  }

  // Validate client (in a real app, you'd validate client_id and client_secret)
  const expectedClientId = process.env.OAUTH_CLIENT_ID || 'solvapay-demo-client';
  if (clientId !== expectedClientId) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Invalid client credentials' },
      { status: 400 }
    );
  }

  // Clean up used authorization code
  authorizationCodes.delete(code);

  // Generate JWT access token using Supabase user ID
  const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
  const issuer = process.env.OAUTH_ISSUER!;
  
  // Use Supabase user ID from authorization code
  const userId = authCodeData.userId;
  
  const accessToken = await new SignJWT({
    sub: userId,
    iss: issuer,
    aud: clientId,
    scope: authCodeData.scopes.join(' ')
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'demo-key' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(jwtSecret);

  const refreshToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  // Store refresh token with expiration (30 days)
  refreshTokens.set(refreshToken, {
    userId: userId,
    clientId,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  });

  console.log('✅ [TOKEN] Generated JWT tokens for client:', clientId, 'user:', userId);

  const res = NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600, // 1 hour
    refresh_token: refreshToken,
    scope: authCodeData.scopes.join(' ')
  });
  
  return res;
}