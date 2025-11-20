import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { accessToken, refreshToken } = await request.json()
    
    if (!accessToken || !refreshToken) {
      return NextResponse.json(
        { error: 'Missing tokens' },
        { status: 400 }
      )
    }

    const response = NextResponse.json({ success: true })
    
    // Set secure HTTP-only cookies
    const maxAge = 60 * 60 * 24 * 30 // 30 days
    const isProduction = process.env.NODE_ENV === 'production'
    
    response.cookies.set('sb-access-token', accessToken, {
      path: '/',
      maxAge,
      httpOnly: false, // Must be false so client JS can access if needed
      secure: isProduction, // Use secure in production (https)
      sameSite: 'lax',
    })
    
    response.cookies.set('sb-refresh-token', refreshToken, {
      path: '/',
      maxAge,
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
    })
    
    return response
  } catch {
    return NextResponse.json(
      { error: 'Failed to set session' },
      { status: 500 }
    )
  }
}

