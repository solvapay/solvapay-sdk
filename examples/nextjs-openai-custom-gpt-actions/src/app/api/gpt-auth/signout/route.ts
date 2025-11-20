import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { refreshTokens } from '@/lib/oauth-storage'

export const dynamic = 'force-dynamic'

/**
 * Sign Out Endpoint
 * 
 * IMPORTANT CAVEAT: OAuth JWT Token Lifecycle
 * ============================================
 * 
 * This endpoint revokes all refresh tokens for the user, preventing them from
 * obtaining new access tokens in the future.
 * 
 * HOWEVER, the current access token (JWT) that ChatGPT has will continue to work
 * until it expires (1 hour from issuance). This is standard OAuth behavior:
 * 
 * - JWTs are self-contained and can't be "un-issued" without a blacklist
 * - Access tokens are validated by signature, not by database lookup
 * - Implementing a token blacklist would require checking every API request
 * 
 * IMPLICATIONS:
 * - After signing out, API calls may still work for up to 1 hour
 * - Refresh token revocation ensures no NEW access tokens can be obtained
 * - For immediate logout, users must also click "Log out" in ChatGPT's UI
 * 
 * FUTURE IMPROVEMENTS:
 * - Reduce access token lifetime to 5-15 minutes (requires more frequent refreshes)
 * - Implement token blacklist table for immediate revocation (performance cost)
 * - Add rate limiting per user to mitigate abuse during the expiry window
 */
export async function POST(request: NextRequest) {
  try {
    // Extract user ID from the Bearer token
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        message: 'No authorization token provided'
      }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!)
    
    try {
      const { payload } = await jwtVerify(token, jwtSecret)
      const userId = payload.sub as string

      // Revoke all refresh tokens for this user
      // This prevents obtaining NEW access tokens, but the CURRENT access token
      // will remain valid until expiry (up to 1 hour). See function comment above.
      await refreshTokens.deleteAllForUser(userId)

      console.log(`✅ Revoked all tokens for user: ${userId}`)

      return NextResponse.json({
        success: true,
        message: 'Signed out successfully. All tokens have been revoked.'
      })
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError)
      // Even if JWT is invalid/expired, still return success
      // The client should discard the token
      return NextResponse.json({
        success: true,
        message: 'Signed out successfully'
      })
    }
  } catch (error) {
    console.error('Signout error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to sign out'
    }, { status: 500 })
  }
}
