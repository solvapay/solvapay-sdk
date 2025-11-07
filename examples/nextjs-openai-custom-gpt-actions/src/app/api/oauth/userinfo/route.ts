import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables not configured');
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

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
    
    try {
      const supabase = getSupabaseClient();
      
      const userInfo: any = {
        sub: userId,
        email_verified: true,
      };

      return NextResponse.json(userInfo);
    } catch (supabaseError) {
      console.error('Supabase user lookup error:', supabaseError);
      return NextResponse.json({
        sub: userId,
        email_verified: true,
      });
    }
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
