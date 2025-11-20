import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { randomBytes } from 'crypto'
import { authCodes, refreshTokens } from '@/lib/oauth-storage'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let body: URLSearchParams
  try {
    const text = await request.text()
    body = new URLSearchParams(text)
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Invalid request body' },
      { status: 400 }
    )
  }

  const grantType = body.get('grant_type')
  const code = body.get('code')
  const redirectUri = body.get('redirect_uri')
  const clientId = body.get('client_id')
  
  // Check for client secret (if provided)
  const clientSecret = body.get('client_secret')
  const expectedClientSecret = process.env.OAUTH_CLIENT_SECRET

  // Validate Grant Type
  if (grantType !== 'authorization_code') {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported' },
      { status: 400 }
    )
  }

  // Validate Client Credentials (if configured)
  const expectedClientId = process.env.OAUTH_CLIENT_ID
  if (expectedClientId && clientId !== expectedClientId) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Invalid client ID' },
      { status: 401 }
    )
  }

  if (expectedClientSecret && clientSecret !== expectedClientSecret) {
     return NextResponse.json(
      { error: 'invalid_client', error_description: 'Invalid client secret' },
      { status: 401 }
    )
  }

  if (!code || !redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing code or redirect_uri' },
      { status: 400 }
    )
  }

  try {
    // 1. Consume Authorization Code
    const codeData = await authCodes.consume(code)

    if (!codeData) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid or expired authorization code' },
        { status: 400 }
      )
    }

    // Validate Redirect URI matches
    if (codeData.redirectUri !== redirectUri) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Redirect URI mismatch' },
        { status: 400 }
      )
    }

    // 2. Generate Access Token (JWT)
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!)
    const issuer = process.env.OAUTH_ISSUER || process.env.PUBLIC_URL || 'https://solvapay.com'

    // NOTE: Access token expiry is set to 1 hour
    // Trade-off: Longer expiry = better UX (fewer refreshes) but slower logout
    // If immediate logout is critical, consider reducing to 5-15 minutes
    // and implementing a token blacklist (see /api/gpt-auth/signout for details)
    const accessToken = await new SignJWT({
      sub: codeData.userId,
      email: codeData.email,
      iss: issuer,
      aud: clientId || 'openai-gpt',
      scope: codeData.scope,
    })
      .setProtectedHeader({ alg: 'HS256', kid: '1' })
      .setIssuedAt()
      .setExpirationTime('1h') // 1 hour expiry
      .sign(jwtSecret)

    // 3. Generate Refresh Token
    const refreshToken = randomBytes(40).toString('hex')
    const refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    await refreshTokens.set({
      token: refreshToken,
      userId: codeData.userId,
      clientId: clientId || 'openai-gpt',
      scope: codeData.scope,
      issuedAt: new Date(),
      expiresAt: refreshTokenExpiresAt
    })

    // 4. Return Response
    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600, // Must match JWT expiration (1 hour = 3600 seconds)
      refresh_token: refreshToken,
      scope: codeData.scope,
    })

  } catch (error) {
    console.error('Token exchange error:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Internal server error' },
      { status: 500 }
    )
  }
}

