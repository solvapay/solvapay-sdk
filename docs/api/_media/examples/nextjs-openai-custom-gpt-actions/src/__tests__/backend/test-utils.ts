import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Test utilities for common test patterns
export const createMockRequest = (url: string, options: RequestInit = {}) => {
  return new NextRequest(url, options.method ? options as any : { method: 'GET', ...options } as any)
}

export const createMockRequestWithAuth = (url: string, token: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return new NextRequest(url, {
    method: options.method || 'GET',
    headers,
    ...options
  } as any)
}

export const createMockRequestWithCustomer = (url: string, customerRef: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers)
  headers.set('x-customer-ref', customerRef)
  return new NextRequest(url, {
    method: options.method || 'GET',
    headers,
    ...options
  } as any)
}

export const expectSuccessfulResponse = (response: Response, expectedStatus = 200) => {
  expect(response.status).toBe(expectedStatus)
}

export const expectErrorResponse = (response: Response, expectedStatus: number, expectedError: string) => {
  expect(response.status).toBe(expectedStatus)
  return response.json().then(data => {
    expect(data.error).toBe(expectedError)
    return data
  })
}

export const expectHtmlResponse = (response: Response, expectedContent: string[]) => {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/html')
  return response.text().then(html => {
    expectedContent.forEach(content => {
      expect(html).toContain(content)
    })
    return html
  })
}

export const expectJsonResponse = (response: Response, expectedStatus = 200) => {
  expect(response.status).toBe(expectedStatus)
  expect(response.headers.get('content-type')).toContain('application/json')
  return response.json()
}

// Mock JWT token creation (for OAuth token testing)
export const createMockJWT = async (payload: any = {}) => {
  const { SignJWT } = await import('jose')
  
  // Ensure the secret is set
  if (!process.env.OAUTH_JWKS_SECRET) {
    throw new Error('OAUTH_JWKS_SECRET environment variable is not set')
  }
  
  const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET)
  
  return await new SignJWT({
    sub: 'user_1',
    iss: process.env.OAUTH_ISSUER!,
    aud: process.env.OAUTH_CLIENT_ID || 'test-client-id',
    scope: 'openid email profile',
    ...payload
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'demo-key' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(jwtSecret)
}

// Test data factories
export const createTestThing = (overrides: any = {}) => ({
  name: 'Test Thing',
  description: 'A test thing for testing',
  ...overrides
})

// Cleanup utilities
export const cleanupUserPlans = () => {
  const { writeFileSync, existsSync, unlinkSync } = require('fs')
  const { join } = require('path')
  
  const USER_PLANS_FILE = join(process.cwd(), 'user-plans.json')
  if (existsSync(USER_PLANS_FILE)) {
    unlinkSync(USER_PLANS_FILE)
  }
}

export const setupTestEnvironment = () => {
  beforeEach(() => {
    // Set up test environment variables
    process.env.NODE_ENV = 'test'
    process.env.SOLVAPAY_SECRET_KEY = 'test-api-key'
    process.env.SOLVAPAY_AGENT = 'test-agent'
    process.env.OAUTH_ISSUER = 'http://localhost:3000'
    process.env.OAUTH_CLIENT_ID = 'test-client-id'
    process.env.OAUTH_CLIENT_SECRET = 'test-client-secret'
    process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback'
    process.env.OAUTH_JWKS_SECRET = 'test-jwt-secret'
  })

  afterEach(() => {
    // Clean up after each test
    cleanupUserPlans()
  })
}
