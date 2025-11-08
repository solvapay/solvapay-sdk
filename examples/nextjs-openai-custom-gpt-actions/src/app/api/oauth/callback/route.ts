import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const OAUTH_PARAMS_COOKIE_NAME = 'oauth_params';

export async function GET(request: NextRequest) {
  try {
    const oauthParamsCookie = request.cookies.get(OAUTH_PARAMS_COOKIE_NAME);
    
    if (!oauthParamsCookie) {
      console.error('OAuth params cookie not found');
      return NextResponse.redirect(new URL('/?error=missing_oauth_params', request.url));
    }

    const oauthParamsJson = atob(oauthParamsCookie.value);
    const oauthParams = JSON.parse(oauthParamsJson);

    const authAdapter = new SupabaseAuthAdapter({ 
      jwtSecret: process.env.SUPABASE_JWT_SECRET! 
    });
    const userId = await authAdapter.getUserIdFromRequest(request);

    if (!userId) {
      console.error('No Supabase session found');
      return NextResponse.redirect(new URL('/?error=no_session', request.url));
    }

    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
    const scopes = oauthParams.scope ? oauthParams.scope.split(' ') : ['openid'];
    
    const authorizationCode = await new SignJWT({
      userId,
      clientId: oauthParams.client_id,
      redirectUri: oauthParams.redirect_uri,
      scopes,
      type: 'authorization_code',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(jwtSecret);

    const redirectUrl = new URL(oauthParams.redirect_uri);
    redirectUrl.searchParams.set('code', authorizationCode);
    if (oauthParams.state) {
      redirectUrl.searchParams.set('state', oauthParams.state);
    }

    const response = NextResponse.redirect(redirectUrl.toString(), { status: 302 });
    response.cookies.delete(OAUTH_PARAMS_COOKIE_NAME);

    return response;
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(new URL('/?error=callback_error', request.url));
  }
}
