import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { revokedTokens } from '@/lib/oauth-storage';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Missing or invalid access token' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7);
  
  // Check if token is revoked
  if (revokedTokens.has(token)) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Token has been revoked' },
      { status: 401 }
    );
  }
  
  try {
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const { payload } = await jwtVerify(token, jwtSecret, {
      issuer: process.env.OAUTH_ISSUER!
    });

    return NextResponse.json({
      sub: payload.sub,
      email: 'demo@example.com',
      name: 'Demo User',
      email_verified: true
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Invalid access token' },
      { status: 401 }
    );
  }
}
