import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as signoutPOST } from '../../app/api/auth/signout/route'
import { createMockJWT } from './test-utils'

describe('Sign Out API', () => {
  beforeEach(() => {
    // Set up test environment variables
    process.env.SOLVAPAY_SECRET_KEY = 'test-api-key'
    process.env.SOLVAPAY_AGENT = 'test-agent'
    process.env.OAUTH_ISSUER = 'http://localhost:3000'
    process.env.OAUTH_CLIENT_ID = 'test-client-id'
    process.env.OAUTH_CLIENT_SECRET = 'test-client-secret'
    process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback'
    process.env.OAUTH_JWKS_SECRET = 'test-jwt-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    // Note: Storage is now in Supabase database - tests may need Supabase mocking
    // For now, tests rely on JWT expiration validation only
  })

  describe('/api/auth/signout', () => {
    it('should sign out using Bearer token in header', async () => {
      const testToken = await createMockJWT()

      const signoutRequest = new NextRequest('http://localhost:3000/api/auth/signout', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${testToken}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new FormData(),
      })

      const signoutResponse = await signoutPOST(signoutRequest)
      expect(signoutResponse.status).toBe(200)

      const signoutData = await signoutResponse.json()
      expect(signoutData.success).toBe(true)
      expect(signoutData.message).toContain('Signed out successfully')
    })
  })
})
