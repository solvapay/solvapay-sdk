import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Check if this is coming from OAuth (Custom GPT) or web UI (cookies)
  const userId = request.headers.get('x-user-id')
  
  if (userId) {
    // OAuth flow - revoke any refresh tokens for this user
    // Note: We can't revoke the JWT access token itself (stateless), but we can remove refresh tokens
    try {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey
      const supabase = createClient(supabaseUrl, serviceRoleKey)
      
      // Delete all refresh tokens for this user (effectively signs them out from Custom GPT)
      await supabase
        .from('oauth_refresh_tokens')
        .delete()
        .eq('user_id', userId)
      
      return NextResponse.json({ 
        success: true, 
        message: 'Signed out successfully. Your access token will expire in 1 hour.' 
      })
    } catch (error) {
      console.error('Error revoking OAuth tokens:', error)
      return NextResponse.json(
        { error: 'Failed to sign out' },
        { status: 500 }
      )
    }
  }

  // Web UI flow - sign out from Supabase and clear cookies
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  })

  const accessToken = request.cookies.get('sb-access-token')?.value
  const refreshToken = request.cookies.get('sb-refresh-token')?.value

  if (accessToken && refreshToken) {
    try {
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Error signing out from Supabase:', error)
    }
  }

  // Clear the cookies
  const response = NextResponse.json({ success: true, message: 'Signed out successfully' })
  
  response.cookies.set('sb-access-token', '', {
    path: '/',
    maxAge: 0,
  })
  
  response.cookies.set('sb-refresh-token', '', {
    path: '/',
    maxAge: 0,
  })

  return response
}
