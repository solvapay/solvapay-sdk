import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Check for Custom OAuth Token (via middleware-set header)
  const oauthUserId = request.headers.get('x-user-id')
  
  if (oauthUserId) {
    // We have a verified OAuth user ID, but we might want more details (email).
    // We can query Supabase using the service role key to get user details.
    // Or just return the ID if that's sufficient.
    // For a /me endpoint, richer data is better.
    
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
      
      const { data: { user }, error } = await supabase.auth.admin.getUserById(oauthUserId)
      
      if (!error && user) {
        return NextResponse.json({
          id: user.id,
          email: user.email,
          role: 'oauth_user',
          provider: 'solvapay_bridge'
        })
      }
    }
    
    // Fallback if we can't fetch full details
    return NextResponse.json({
      id: oauthUserId,
      role: 'oauth_user'
    })
  }

  // Fallback to Standard Supabase Session (Cookie)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
      }
    }
  )

  const accessToken = request.cookies.get('sb-access-token')?.value
  const refreshToken = request.cookies.get('sb-refresh-token')?.value

  if (accessToken && refreshToken) {
    const { data: { user }, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    if (!error && user) {
      return NextResponse.json({
        id: user.id,
        email: user.email,
        role: 'authenticated',
        provider: 'supabase'
      })
    }
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

