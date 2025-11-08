import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { refreshTokens } from '@/lib/oauth-storage'

export async function POST(request: NextRequest) {
  let token: string | null = null
  let tokenTypeHint: string | null = null

  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
    tokenTypeHint = 'access_token'
  } else {
    const formData = await request.formData()
    token = formData.get('token') as string
    tokenTypeHint = formData.get('token_type_hint') as string
  }

  if (!token) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing token parameter' },
      { status: 400 },
    )
  }

  try {
    if (tokenTypeHint === 'refresh_token' || (await refreshTokens.has(token))) {
      const refreshTokenData = await refreshTokens.get(token)
      if (refreshTokenData) {
        await refreshTokens.delete(token)

        return NextResponse.json({
          success: true,
          message: 'Successfully signed out',
        })
      }
    }

    try {
      const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!)
      await jwtVerify(token, jwtSecret, {
        issuer: process.env.OAUTH_ISSUER!,
      })

      return NextResponse.json({
        success: true,
        message: 'Successfully signed out (access token will expire naturally)',
      })
    } catch {
      // Token verification failed, but we still return success
      return NextResponse.json({
        success: true,
        message: 'Sign out completed',
      })
    }
  } catch (error) {
    console.error('Error during sign out:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error during sign out' },
      { status: 500 },
    )
  }
}
