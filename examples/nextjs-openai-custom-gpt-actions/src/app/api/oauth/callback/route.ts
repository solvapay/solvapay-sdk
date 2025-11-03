import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizationCodes } from '@/lib/oauth-storage';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

/**
 * OAuth Callback API Route
 * 
 * Handles the Supabase OAuth callback:
 * 1. Extracts Supabase session
 * 2. Gets OAuth params from cookie
 * 3. Generates authorization code
 * 4. Redirects to OpenAI's redirect_uri with the code
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
  try {
    // Get OAuth params from cookie
    const oauthParamsCookie = request.cookies.get(OAUTH_PARAMS_COOKIE_NAME);
    
    if (!oauthParamsCookie) {
      console.error('OAuth params cookie not found');
      return NextResponse.redirect(new URL('/?error=missing_oauth_params', request.url));
    }

    // Decode base64 cookie value (Edge-compatible)
    const oauthParamsJson = atob(oauthParamsCookie.value);
    const oauthParams = JSON.parse(oauthParamsJson);

    // Get Supabase session from the request
    const authAdapter = new SupabaseAuthAdapter({ 
      jwtSecret: process.env.SUPABASE_JWT_SECRET! 
    });
    const userId = await authAdapter.getUserIdFromRequest(request);

    if (!userId) {
      console.error('No Supabase session found');
      return NextResponse.redirect(new URL('/?error=no_session', request.url));
    }

    // Generate authorization code
    const code = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    // Store authorization code with expiration
    authorizationCodes.set(code, {
      userId: userId,
      clientId: oauthParams.client_id,
      redirectUri: oauthParams.redirect_uri,
      scopes: oauthParams.scope ? oauthParams.scope.split(' ') : ['openid'],
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      email: '' // Email will be available from Supabase session if needed
    });

    console.log('✅ [OAUTH CALLBACK] Generated authorization code for user:', userId);

    // Redirect to OpenAI's redirect_uri with authorization code
    const redirectUrl = new URL(oauthParams.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (oauthParams.state) {
      redirectUrl.searchParams.set('state', oauthParams.state);
    }

    // Clear the OAuth params cookie
    const response = NextResponse.redirect(redirectUrl.toString(), { status: 302 });
    response.cookies.delete(OAUTH_PARAMS_COOKIE_NAME);

    return response;
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(new URL('/?error=callback_error', request.url));
  }
}

