import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as openidConfigGET } from '../../app/api/.well-known/openid-configuration/route'
import { GET as jwksGET } from '../../app/api/oauth/jwks/route'
import { GET as authorizeGET, POST as authorizePOST } from '../../app/api/oauth/authorize/route'
import { POST as tokenPOST } from '../../app/api/oauth/token/route'
import { GET as userinfoGET } from '../../app/api/oauth/userinfo/route'
import { createMockJWT } from './test-utils'

describe.skipIf(process.env.SKIP_BACKEND_JWT_TESTS === '1')('OAuth Endpoints', () => {
  describe('/api/.well-known/openid-configuration', () => {
    it('should return OpenID Connect configuration', async () => {
      const response = await openidConfigGET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.issuer).toBe('http://localhost:3000')
      expect(data.authorization_endpoint).toBe('http://localhost:3000/api/oauth/authorize')
      expect(data.token_endpoint).toBe('http://localhost:3000/api/oauth/token')
    })
  })

  describe('/api/oauth/authorize', () => {
    it('should handle successful login', async () => {
      const formData = new FormData()
      formData.append('client_id', 'test-client-id')
      formData.append('redirect_uri', 'http://localhost:3000/oauth/callback')
      formData.append('response_type', 'code')
      formData.append('scope', 'openid')
      formData.append('email', 'demo@example.com')
      formData.append('password', 'demo123')

      const request = new NextRequest('http://localhost:3000/api/oauth/authorize', {
        method: 'POST',
        body: formData
      })

      const response = await authorizePOST(request as NextRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toContain('http://localhost:3000/oauth/callback')
      expect(response.headers.get('location')).toContain('code=')
    })
  })

  describe('/api/oauth/token', () => {
    it('should exchange authorization code for access token', async () => {
      // First, get an authorization code
      const authFormData = new FormData()
      authFormData.append('client_id', 'test-client-id')
      authFormData.append('redirect_uri', 'http://localhost:3000/oauth/callback')
      authFormData.append('response_type', 'code')
      authFormData.append('scope', 'openid')
      authFormData.append('email', 'demo@example.com')
      authFormData.append('password', 'demo123')

      const authRequest = new NextRequest('http://localhost:3000/api/oauth/authorize', {
        method: 'POST',
        body: authFormData
      })

      const authResponse = await authorizePOST(authRequest as NextRequest)
      const redirectUrl = authResponse.headers.get('location')
      const url = new URL(redirectUrl!)
      const code = url.searchParams.get('code')

      // Now exchange the code for a token
      const tokenFormData = new FormData()
      tokenFormData.append('grant_type', 'authorization_code')
      tokenFormData.append('code', code!)
      tokenFormData.append('redirect_uri', 'http://localhost:3000/oauth/callback')
      tokenFormData.append('client_id', 'test-client-id')
      tokenFormData.append('client_secret', 'test-client-secret')

      const tokenRequest = new NextRequest('http://localhost:3000/api/oauth/token', {
        method: 'POST',
        body: tokenFormData
      })

      const tokenResponse = await tokenPOST(tokenRequest as NextRequest)
      const tokenData = await tokenResponse.json()

      expect(tokenResponse.status).toBe(200)
      expect(tokenData.access_token).toBeDefined()
      expect(tokenData.token_type).toBe('Bearer')
    })
  })
})
