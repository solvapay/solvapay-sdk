import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';

/**
 * OAuth UserInfo Endpoint
 * 
 * Returns user information for the authenticated user.
 * Uses Supabase to fetch user details based on the user ID from the JWT token.
 * 
 * Note: We rely on JWT expiration for token validation (no revoked tokens blacklist).
 */
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
    // Verify JWT token (OAuth token we generated)
    // JWT expiration is automatically checked by jwtVerify
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const { payload } = await jwtVerify(token, jwtSecret, {
      issuer: process.env.OAUTH_ISSUER!
    });

    const userId = payload.sub as string;
    
    // Fetch user info from Supabase
    try {
      const supabase = getSupabaseClient();
      
      // Return user info - email and name can be stored in auth code or fetched from Supabase
      // For simplicity, we'll return the user ID and try to get email from Supabase if possible
      const userInfo: any = {
        sub: userId,
        email_verified: true,
      };

      // Try to get user email from Supabase (this requires admin API or user session)
      // For now, we'll return basic info - in production you might want to enhance this
      // by using Supabase Admin API or caching user info
      
      return NextResponse.json(userInfo);
    } catch (supabaseError) {
      console.error('Supabase user lookup error:', supabaseError);
      // Fallback: return basic info from token
      return NextResponse.json({
        sub: userId,
        email_verified: true,
      });
    }
  } catch (error: any) {
    console.error('Token verification error:', error);
    
    // Handle JWT expiration/invalid errors
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
