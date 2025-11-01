import { NextRequest, NextResponse } from 'next/server';
import { SignInUrlResponse } from '@/lib/schemas';

/**
 * GET /api/auth/signin-url
 * 
 * Public endpoint that provides the OAuth sign-in URL for OpenAI Custom GPT Actions.
 * This endpoint doesn't require authentication and helps the AI agent guide users
 * through the sign-in process.
 */
export async function GET(request: NextRequest) {
  try {
    // Get OAuth configuration from environment variables - no fallbacks!
    const clientId = process.env.OAUTH_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;
    const baseUrl = process.env.PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    
    // Validate all required configuration
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
    
    // Generate OAuth parameters (variables are validated above)
    const oauthParams = new URLSearchParams({
      response_type: 'code',
      client_id: clientId!,
      redirect_uri: redirectUri!,
      scope: 'openid email profile',
      state: crypto.randomUUID() // Generate a random state for security
    });
    
    const signInUrl = `${baseUrl}/api/oauth/authorize?${oauthParams.toString()}`;
    
    const response: SignInUrlResponse = {
      signInUrl,
      instructions: 'Please visit this URL to sign in with your account using OAuth flow.'
    };
    
    console.log('🔗 [SIGNIN URL] Generated sign-in URL:', signInUrl);
    console.log('🔧 [SIGNIN URL] Using client_id:', clientId);
    console.log('🔧 [SIGNIN URL] Using redirect_uri:', redirectUri);
    
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
