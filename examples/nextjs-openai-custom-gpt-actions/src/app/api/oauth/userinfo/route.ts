import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Missing or invalid access token' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7);
  
  try {
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const { payload } = await jwtVerify(token, jwtSecret, {
      issuer: process.env.OAUTH_ISSUER!
    });

    const userId = payload.sub as string;
    
    // Return basic user info (email lookup via Supabase could be added here if needed)
    // const supabase = getSupabaseClient(); // Reserved for future use
    const userInfo: any = {
      sub: userId,
      email_verified: true,
    };

    return NextResponse.json(userInfo);
  } catch (error: any) {
    console.error('Token verification error:', error);
    
    if (error.name === 'JWTExpired' || error.name === 'JWTInvalid') {
      return NextResponse.json(
        { error: 'invalid_token', error_description: 'Invalid or expired access token' },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Invalid access token' },
      { status: 401 }
    );
  }
}
