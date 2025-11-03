import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * OAuth Authorization Endpoint
 * 
 * For OpenAI Custom GPT Actions compatibility, this endpoint:
 * 1. Stores OAuth params (client_id, redirect_uri, state) in a cookie
 * 2. Redirects to Supabase Google OAuth
 * 3. After Supabase auth completes, /auth/callback will generate an authorization code
 *    and redirect back to the original redirect_uri
 */

const OAUTH_PARAMS_COOKIE_NAME = 'oauth_params';

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables not configured');
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const scope = url.searchParams.get('scope');
  const state = url.searchParams.get('state');

  if (!clientId || !redirectUri || !responseType) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      { status: 400 }
    );
  }

  // Store OAuth params in a cookie so /auth/callback can use them
  const oauthParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope: scope || 'openid email profile',
    state: state || '',
  };

  try {
    const supabase = getSupabaseClient();
    const callbackUrl = `${request.nextUrl.origin}/auth/callback`;
    
    // Store OAuth params in cookie (base64 encoded JSON)
    const paramsCookie = btoa(JSON.stringify(oauthParams));
    
    // Redirect to Supabase Google OAuth
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
        queryParams: {
          // Pass OAuth params through state parameter (Supabase will preserve it)
          // We'll encode our params in the state
          state: btoa(JSON.stringify(oauthParams)),
        },
      },
    });

    if (error) {
      console.error('Supabase OAuth error:', error);
      return NextResponse.json(
        { error: 'oauth_error', error_description: 'Failed to initiate OAuth flow' },
        { status: 500 }
      );
    }

    // Set cookie with OAuth params
    const response = NextResponse.redirect(data.url, { status: 302 });
    response.cookies.set(OAUTH_PARAMS_COOKIE_NAME, paramsCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10, // 10 minutes (same as auth code expiration)
    });

    return response;
  } catch (error) {
    console.error('OAuth authorize error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to initiate OAuth flow' },
      { status: 500 }
    );
  }
}

// POST handler removed - Supabase handles authentication
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'method_not_allowed', error_description: 'Use GET to initiate OAuth flow' },
    { status: 405 }
  );
}
