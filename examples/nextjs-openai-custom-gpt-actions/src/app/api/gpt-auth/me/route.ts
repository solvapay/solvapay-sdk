import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Middleware verifies OAuth token and sets this header
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    // Not authenticated
    return NextResponse.json({
      isAuthenticated: false,
      userId: null,
      email: null,
      name: null
    })
  }

  // Fetch user details using Service Role (admin) to get full profile
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
     // Fallback if config missing, just return ID
     return NextResponse.json({
       isAuthenticated: true,
       userId,
       email: request.headers.get('x-user-email'),
     })
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
  const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId)

  if (error || !user) {
     // Fallback if user not found
     return NextResponse.json({
       isAuthenticated: true,
       userId,
       email: request.headers.get('x-user-email'),
     })
  }

  return NextResponse.json({
    isAuthenticated: true,
    userId: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name,
    avatarUrl: user.user_metadata?.avatar_url,
    metadata: user.user_metadata,
    // You can extend this to fetch subscription plan from your DB
    plan: user.user_metadata?.plan || 'free' 
  })
}
