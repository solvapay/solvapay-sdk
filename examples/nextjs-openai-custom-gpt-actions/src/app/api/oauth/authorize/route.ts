import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { authCodes } from '@/lib/oauth-storage'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const redirectUri = searchParams.get('redirect_uri')
  const responseType = searchParams.get('response_type')
  const scope = searchParams.get('scope') || 'openid email profile'
  const state = searchParams.get('state') || ''

  // 1. Validate OAuth parameters
  if (!clientId || !redirectUri || responseType !== 'code') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing required OAuth parameters' },
      { status: 400 }
    )
  }

  // Validate Client ID
  const expectedClientId = process.env.OAUTH_CLIENT_ID
  if (expectedClientId && clientId !== expectedClientId) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Invalid client ID' },
      { status: 401 }
    )
  }

  // Validate Redirect URI (security check)
  // Only allow redirects to OpenAI domains
  const allowedRedirectDomains = ['chat.openai.com', 'chatgpt.com']
  try {
    const redirectUrl = new URL(redirectUri)
    if (!allowedRedirectDomains.includes(redirectUrl.hostname)) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Unauthorized redirect URI' },
        { status: 400 }
      )
    }
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Invalid redirect URI format' },
      { status: 400 }
    )
  }

  // 2. Check for existing Supabase session
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
      }
    }
  )

  // Get session from cookies
  const accessToken = request.cookies.get('sb-access-token')?.value
  const refreshToken = request.cookies.get('sb-refresh-token')?.value

  let userId: string | null = null
  let userEmail: string | null = null

  if (accessToken && refreshToken) {
    const { data: { user } } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    userId = user?.id || null
    userEmail = user?.email || null
  } else {
    // Try getting user from auth header if available (e.g. during dev testing)
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
       const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1])
       userId = user?.id || null
       userEmail = user?.email || null
    }
  }

  // 3. If not authenticated, redirect to login
  if (!userId) {
    // Construct login URL with return path
    // We need to encode the current URL as the 'next' or 'redirect_to' param
    // so the login page knows where to send the user back to after login
    const currentUrl = new URL(request.url)
    // Ensure we use the public URL for the redirect
    const baseUrl = process.env.PUBLIC_URL || `https://${request.headers.get('host')}`
    const loginUrl = new URL('/login', baseUrl)
    
    // Pass the current full URL as the destination after login
    // The login page logic (in Auth.tsx) should handle this 'redirect_to' query param
    loginUrl.searchParams.set('redirect_to', currentUrl.pathname + currentUrl.search)
    
    return NextResponse.redirect(loginUrl)
  }

  // 4. Generate Authorization Code
  const code = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  try {
    await authCodes.set({
      code,
      userId,
      email: userEmail || '',
      clientId,
      redirectUri,
      scope,
      expiresAt
    })
  } catch (error) {
    console.error('Failed to store auth code:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to generate authorization code' },
      { status: 500 }
    )
  }

  // 5. Redirect to Callback URL
  const callbackUrl = new URL(redirectUri)
  callbackUrl.searchParams.set('code', code)
  if (state) callbackUrl.searchParams.set('state', state)

  return NextResponse.redirect(callbackUrl)
}

