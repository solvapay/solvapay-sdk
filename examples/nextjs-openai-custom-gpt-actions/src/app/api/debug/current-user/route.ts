import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { readSessionUserIdFromRequest } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const sessionUser = await readSessionUserIdFromRequest(request as unknown as Request);
    if (sessionUser) {
      return NextResponse.json({ success: true, userId: sessionUser, source: 'session' });
    }
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
      payload: payload
    });
  } catch (error) {
    return NextResponse.json({
      error: 'JWT verification failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
