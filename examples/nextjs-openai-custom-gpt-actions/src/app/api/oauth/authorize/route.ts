import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const OAUTH_PARAMS_COOKIE_NAME = 'oauth_params'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables not configured')
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id')
  const redirectUri = url.searchParams.get('redirect_uri')
  const responseType = url.searchParams.get('response_type')
  const scope = url.searchParams.get('scope')
  const state = url.searchParams.get('state')

  if (!clientId || !redirectUri || !responseType) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      { status: 400 },
    )
  }

  const oauthParams = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope: scope || 'openid email profile',
    state: state || '',
  }

  try {
    const supabase = getSupabaseClient()
    const callbackUrl = `${request.nextUrl.origin}/auth/callback`

    const paramsCookie = btoa(JSON.stringify(oauthParams))

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
        queryParams: {
          state: btoa(JSON.stringify(oauthParams)),
        },
      },
    })

    if (error) {
      console.error('Supabase OAuth error:', error)
      return NextResponse.json(
        { error: 'oauth_error', error_description: 'Failed to initiate OAuth flow' },
        { status: 500 },
      )
    }

    const response = NextResponse.redirect(data.url, { status: 302 })
    response.cookies.set(OAUTH_PARAMS_COOKIE_NAME, paramsCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })

    return response
  } catch (error) {
    console.error('OAuth authorize error:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to initiate OAuth flow' },
      { status: 500 },
    )
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'method_not_allowed', error_description: 'Use GET to initiate OAuth flow' },
    { status: 405 },
  )
}
