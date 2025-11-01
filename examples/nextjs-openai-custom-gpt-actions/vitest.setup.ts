import { beforeAll, afterAll } from 'vitest'
import '@testing-library/jest-dom'

// Mock environment variables
beforeAll(() => {
  process.env.SOLVAPAY_SECRET_KEY = 'demo-key-for-development'
  process.env.SOLVAPAY_AGENT = 'custom-gpt-actions'
  process.env.OAUTH_ISSUER = 'http://localhost:3000'
  process.env.OAUTH_CLIENT_ID = 'test-client-id'
  process.env.OAUTH_CLIENT_SECRET = 'test-client-secret'
  process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback'
  process.env.OAUTH_JWKS_SECRET = 'test-jwt-secret-key-32-bytes-long'
  process.env.CHECKOUT_BASE_URL = 'http://localhost:3000'
  process.env.PUBLIC_URL = 'http://localhost:3000'
  process.env.SKIP_BACKEND_JWT_TESTS = process.env.SKIP_BACKEND_JWT_TESTS || '1'
})

afterAll(() => {
  // Cleanup if needed
})
