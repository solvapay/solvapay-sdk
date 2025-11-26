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
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Invalid redirect URI format' },
      { status: 400 }
    )
  }

  // 2. Authentication & Consent Handling
  // Always redirect to login page if "confirmed" param is missing.
  // This ensures the user explicitly confirms their identity and can switch accounts.
  const confirmed = searchParams.get('confirmed') === 'true'
  
  if (!confirmed) {
    // Construct login URL with return path
    const currentUrl = new URL(request.url)
    // Append confirmed=true to the return URL so that when they come back, we skip this block
    currentUrl.searchParams.set('confirmed', 'true')
    
    // Ensure we use the public URL for the redirect
    const baseUrl = process.env.PUBLIC_URL || `https://${request.headers.get('host')}`
    const loginUrl = new URL('/login', baseUrl)
    
    // Pass the return URL
    loginUrl.searchParams.set('redirect_to', currentUrl.pathname + currentUrl.search)
    
    // Always force login to ensure user sees the login screen
    loginUrl.searchParams.set('force_login', 'true')
    
    return NextResponse.redirect(loginUrl)
  }

  // 3. Check for existing Supabase session (after user confirmed via login page)
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
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'access_denied', error_description: 'User not authenticated after login' },
      { status: 401 }
    )
  }

  // 3.5. Sync customer with SolvaPay backend to ensure externalRef is set
  // This is critical to prevent 409/404 loops
  try {
    const { createSolvaPay } = await import('@solvapay/server')
    const solvaPay = createSolvaPay()
    
    // Use userId as-is (with hyphens) for both customerRef and externalRef
    // Pass email to avoid conflicts
    await solvaPay.ensureCustomer(userId, userId, {
      email: userEmail || undefined,
    })
  } catch (syncError) {
    // Don't block OAuth flow if sync fails, just log
    console.error('❌ Failed to sync customer during OAuth flow:', syncError)
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

