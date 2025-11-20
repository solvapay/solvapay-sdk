import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Check if user info is from OAuth token (set by middleware)
  const userId = request.headers.get('x-user-id')
  const userEmail = request.headers.get('x-user-email')
  
  if (userId) {
    // OAuth flow - user info from JWT claims
    return NextResponse.json({
      authenticated: true,
      user: {
        id: userId,
        email: userEmail || undefined,
      },
    })
  }

  // Web UI flow - user info from Supabase session
  // Middleware already verified the session, so we can trust the cookies
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  })

  const accessToken = request.cookies.get('sb-access-token')?.value
  const refreshToken = request.cookies.get('sb-refresh-token')?.value

  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      { error: 'Not authenticated', authenticated: false },
      { status: 401 }
    )
  }

  try {
    const { data: { user } } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session', authenticated: false },
        { status: 401 }
      )
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch user', authenticated: false },
      { status: 500 }
    )
  }
}
