import { beforeAll, afterAll } from 'vitest'
import '@testing-library/jest-dom'

// Set environment variables synchronously before any imports
// This ensures they're available when modules are loaded
process.env.SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY || 'demo-key-for-development'
process.env.SOLVAPAY_AGENT = process.env.SOLVAPAY_AGENT || 'custom-gpt-actions'
process.env.OAUTH_ISSUER = process.env.OAUTH_ISSUER || 'http://localhost:3000'
process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'test-client-id'
process.env.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || 'test-client-secret'
process.env.OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback'
process.env.OAUTH_JWKS_SECRET = process.env.OAUTH_JWKS_SECRET || 'test-jwt-secret-key-32-bytes-long'
process.env.CHECKOUT_BASE_URL = process.env.CHECKOUT_BASE_URL || 'http://localhost:3000'
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000'
process.env.SKIP_BACKEND_JWT_TESTS = process.env.SKIP_BACKEND_JWT_TESTS || '1'

// Mock environment variables
beforeAll(() => {
  // Ensure env vars are set (they should already be set above, but this ensures they're set for tests)
  process.env.SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY || 'demo-key-for-development'
  process.env.SOLVAPAY_AGENT = process.env.SOLVAPAY_AGENT || 'custom-gpt-actions'
  process.env.OAUTH_ISSUER = process.env.OAUTH_ISSUER || 'http://localhost:3000'
  process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'test-client-id'
  process.env.OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || 'test-client-secret'
  process.env.OAUTH_REDIRECT_URI =
    process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback'
  process.env.OAUTH_JWKS_SECRET =
    process.env.OAUTH_JWKS_SECRET || 'test-jwt-secret-key-32-bytes-long'
  process.env.CHECKOUT_BASE_URL = process.env.CHECKOUT_BASE_URL || 'http://localhost:3000'
  process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000'
  process.env.SKIP_BACKEND_JWT_TESTS = process.env.SKIP_BACKEND_JWT_TESTS || '1'
})

afterAll(() => {
  // Cleanup if needed
})
