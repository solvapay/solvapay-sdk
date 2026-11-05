import { describe, expect, it } from 'vitest'
import {
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
} from '../src/oauth-discovery'

const publicBaseUrl = 'https://mcp.example.com'

describe('getOAuthProtectedResourceResponse', () => {
  it('defaults to SolvaPay as the authorization server (unchanged output)', () => {
    expect(getOAuthProtectedResourceResponse(`${publicBaseUrl}/`)).toEqual({
      resource: publicBaseUrl,
      authorization_servers: [publicBaseUrl],
      scopes_supported: ['openid', 'profile', 'email'],
    })
  })

  it('emits external issuers verbatim, trailing slash and path component included', () => {
    expect(
      getOAuthProtectedResourceResponse(publicBaseUrl, {
        authorizationServers: ['https://tenant.eu.auth0.com/', 'https://ref.supabase.co/auth/v1'],
        scopesSupported: ['openid', 'profile', 'email', 'offline_access'],
        resource: `${publicBaseUrl}/mcp`,
      }),
    ).toEqual({
      resource: `${publicBaseUrl}/mcp`,
      authorization_servers: ['https://tenant.eu.auth0.com/', 'https://ref.supabase.co/auth/v1'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    })
  })

  it('returns a fresh scopes array each call', () => {
    const a = getOAuthProtectedResourceResponse(publicBaseUrl)
    a.scopes_supported.push('mutated')
    expect(getOAuthProtectedResourceResponse(publicBaseUrl).scopes_supported).toEqual([
      'openid',
      'profile',
      'email',
    ])
    expect(getOAuthAuthorizationServerResponse({ publicBaseUrl }).scopes_supported).toEqual([
      'openid',
      'profile',
      'email',
    ])
  })
})
