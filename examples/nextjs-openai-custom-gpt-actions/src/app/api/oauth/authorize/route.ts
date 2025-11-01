import { NextRequest, NextResponse } from 'next/server';
import { users, authorizationCodes } from '@/lib/oauth-storage';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/session';

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

  // Return login form
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>OAuth Login</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; }
        input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #005a87; }
      </style>
    </head>
    <body>
      <h2>OAuth Login</h2>
      <p>Client: ${clientId}</p>
      <p>Redirect: ${redirectUri}</p>
      
      <form method="POST">
        <input type="hidden" name="client_id" value="${clientId}">
        <input type="hidden" name="redirect_uri" value="${redirectUri}">
        <input type="hidden" name="response_type" value="${responseType}">
        <input type="hidden" name="scope" value="${scope}">
        <input type="hidden" name="state" value="${state || ''}">
        
        <div class="form-group">
          <label for="email">Email:</label>
          <input type="email" id="email" name="email" value="demo@example.com" required>
        </div>
        
        <div class="form-group">
          <label for="password">Password:</label>
          <input type="password" id="password" name="password" value="demo123" required>
        </div>
        
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const clientId = formData.get('client_id') as string;
  const redirectUri = formData.get('redirect_uri') as string;
  const responseType = formData.get('response_type') as string;
  const scope = formData.get('scope') as string;
  const state = formData.get('state') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  console.log('🔍 [OAUTH API DEBUG] Received form data:', {
    clientId,
    redirectUri,
    responseType,
    scope,
    state,
    email: email ? '***@***' : 'missing'
  });

  if (!clientId || !redirectUri || !responseType) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      { status: 400 }
    );
  }

  // Check credentials against user map; optionally allow dynamic demo users
  let user = users.get(email);
  if (!user) {
    const allowAny = (process.env.OAUTH_ALLOW_ANY_USER || '').toLowerCase() === 'true';
    if (allowAny) {
      // Create a demo user on-the-fly for this email
      const sanitized = email.toLowerCase().replace(/[^a-z0-9]/g, '_');
      user = { id: `user_${sanitized}`, email, name: email.split('@')[0], password: password || 'demo123' };
      users.set(email, user);
      console.log('🆕 [OAUTH DEBUG] Created demo user:', user.id, 'for email:', email);
    }
  }
  if (!user || user.password !== password) {
    // Invalid credentials
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Invalid credentials' },
      { status: 400 }
    );
  }

  // Generate authorization code
  const code = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  // Store authorization code with expiration
  authorizationCodes.set(code, {
    userId: user.id,
    clientId,
    redirectUri,
    scopes: scope ? scope.split(' ') : ['openid'],
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    email: user.email
  });
  
  // Generated auth code for user
  
  // Redirect with authorization code - redirectUri is already an absolute URL
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);
  
  console.log('🔄 [OAUTH] Redirecting to:', redirectUrl.toString());
  
  // Set browser session cookie so subsequent browser requests (e.g. checkout) carry identity
  const sessionToken = await createSessionToken({ userId: user.id });
  const res = NextResponse.redirect(redirectUrl.toString(), { status: 302 });
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
  return res;
}
