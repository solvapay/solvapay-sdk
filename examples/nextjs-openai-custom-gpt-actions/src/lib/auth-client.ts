import { SolvapayOAuthClient } from '@solvapay/auth'

export const authClient = new SolvapayOAuthClient({
  clientId: process.env.SOLVAPAY_CLIENT_ID!,
  clientSecret: process.env.SOLVAPAY_CLIENT_SECRET,
  authUrl: process.env.SOLVAPAY_AUTH_URL || 'https://api.solvapay.com/v1/oauth/authorize',
  tokenUrl: process.env.SOLVAPAY_TOKEN_URL || 'https://api.solvapay.com/v1/oauth/token',
  redirectUri: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/auth/callback`,
})

export const SOLVAPAY_USERINFO_URL = process.env.SOLVAPAY_USERINFO_URL || 'https://api.solvapay.com/v1/oauth/userinfo'

