import { NextResponse } from 'next/server';
import { SignInUrlResponse } from '@/lib/schemas';

export async function GET() {
  try {
    const clientId = process.env.OAUTH_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;
    const baseUrl = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    
    const missingVars: string[] = [];
    if (!clientId) missingVars.push('OAUTH_CLIENT_ID');
    if (!redirectUri) missingVars.push('OAUTH_REDIRECT_URI');
    if (!baseUrl) missingVars.push('PUBLIC_URL');
    
    if (missingVars.length > 0) {
      const errorMsg = `Missing required environment variables: ${missingVars.join(', ')}`;
      console.error('❌ [SIGNIN URL]', errorMsg);
      return NextResponse.json(
        { 
          error: 'server_misconfiguration', 
          error_description: `OAuth configuration incomplete: ${errorMsg}` 
        },
        { status: 500 }
      );
    }
    
    const oauthParams = new URLSearchParams({
      response_type: 'code',
      client_id: clientId!,
      redirect_uri: redirectUri!,
      scope: 'openid email profile',
      state: crypto.randomUUID()
    });
    
    const signInUrl = `${baseUrl}/api/oauth/authorize?${oauthParams.toString()}`;
    
    const response: SignInUrlResponse = {
      signInUrl,
      instructions: 'Please visit this URL to sign in with your account using OAuth flow.'
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('❌ [SIGNIN URL] Error generating sign-in URL:', error);
    
    return NextResponse.json(
      { 
        error: 'internal_server_error', 
        error_description: 'Failed to generate sign-in URL' 
      },
      { status: 500 }
    );
  }
}
