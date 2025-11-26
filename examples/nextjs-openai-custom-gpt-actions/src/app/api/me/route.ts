import { authClient, SOLVAPAY_USERINFO_URL } from '@/lib/auth-client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Check for header set by middleware (userId)
  const userId = request.headers.get('x-user-id')
  
  // Also check cookie to fetch full user info
  const cookieStore = await cookies()
  const token = cookieStore.get('solvapay_token')?.value

  if (!userId || !token) {
     return NextResponse.json(
      { error: 'Not authenticated', authenticated: false },
      { status: 401 }
    )
  }

  try {
    // Fetch full user info from SolvaPay
    const userInfo = await authClient.getUserInfo(token, SOLVAPAY_USERINFO_URL)

    return NextResponse.json({
      authenticated: true,
      user: {
        id: userId,
        email: userInfo.email,
        name: userInfo.name,
      },
    })
  } catch (error) {
    console.error('Failed to fetch user info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user info', authenticated: false },
      { status: 500 }
    )
  }
}
