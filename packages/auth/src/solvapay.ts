/**
 * SolvaPay Auth Adapter
 *
 * Validates SolvaPay OAuth tokens by calling the userinfo endpoint.
 * Suitable for validating opaque tokens issued by SolvaPay's hosted OAuth service.
 */

import type { AuthAdapter, RequestLike } from './adapter'

export interface SolvapayAuthAdapterConfig {
  /**
   * SolvaPay API Base URL (e.g. https://api.solvapay.com)
   */
  apiBaseUrl: string
}

/**
 * SolvaPay authentication adapter
 *
 * Validates tokens by calling the SolvaPay userinfo endpoint.
 * This is required for opaque tokens which cannot be verified offline.
 */
export class SolvapayAuthAdapter implements AuthAdapter {
  private apiBaseUrl: string

  constructor(config: SolvapayAuthAdapterConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, '')
  }

  async getUserIdFromRequest(req: Request | RequestLike): Promise<string | null> {
    try {
      const headers = 'headers' in req ? req.headers : req
      const authHeader = headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null
      }

      const token = authHeader.slice(7)
      if (!token) {
        return null
      }

      // Call SolvaPay userinfo endpoint to validate token and get user ID
      const response = await fetch(`${this.apiBaseUrl}/v1/oauth/userinfo`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        return null
      }

      const userInfo = await response.json()
      
      // Return subject (User ID) or customer reference
      return userInfo.sub || userInfo.id || userInfo.customerRef || null
    } catch {
      return null
    }
  }
}

/**
 * SolvaPay OAuth Client Helpers
 */

export interface SolvapayOAuthConfig {
  clientId: string
  clientSecret?: string
  authUrl: string
  tokenUrl: string
  redirectUri: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

export class SolvapayOAuthClient {
  constructor(private config: SolvapayOAuthConfig) {}

  /**
   * Get the URL to redirect the user to for login
   */
  getAuthorizationUrl(options: { state?: string; scope?: string } = {}): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
    })

    if (options.state) params.append('state', options.state)
    if (options.scope) params.append('scope', options.scope)

    return `${this.config.authUrl}?${params.toString()}`
  }

  /**
   * Exchange an authorization code for an access token
   */
  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
    })

    if (this.config.clientSecret) {
      body.append('client_secret', this.config.clientSecret)
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to exchange code: ${response.status} ${text}`)
    }

    return response.json()
  }

  /**
   * Revoke a token (Sign Out)
   */
  async revokeToken(token: string): Promise<void> {
    // Note: Standard RFC7009 revocation endpoint is usually /oauth/revoke
    // Assuming SolvaPay follows this or uses a specific endpoint.
    // Constructing revocation URL based on tokenUrl pattern if not explicitly provided,
    // or using a known path relative to apiBaseUrl if available.
    // For now, assuming it's near the token endpoint.
    const revokeUrl = this.config.tokenUrl.replace('/token', '/revoke')
    
    const body = new URLSearchParams({
      token,
      client_id: this.config.clientId,
    })

    if (this.config.clientSecret) {
      body.append('client_secret', this.config.clientSecret)
    }

    await fetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
  }
  
  /**
   * Get user info using access token
   */
  async getUserInfo(accessToken: string, userInfoUrl?: string): Promise<Record<string, unknown>> {
      // If userInfoUrl is not provided, try to guess from tokenUrl or config
      // But typically this client is used alongside the adapter which knows the base URL
      if (!userInfoUrl) {
          throw new Error('userInfoUrl is required')
      }
      
      const response = await fetch(userInfoUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.status}`)
      }

      return response.json()
  }
}

