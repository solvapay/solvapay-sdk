import type { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import type { AuthAdapter } from '@solvapay/auth'
import { createAuthMiddleware } from '../middleware'

function makeNextRequest(path: string): NextRequest {
  const url = `https://example.com${path}`
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers(),
  } as NextRequest
}

describe('createAuthMiddleware', () => {
  it('returns 401 for protected API routes without auth', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => null),
    }

    const middleware = createAuthMiddleware({ adapter })
    const response = await middleware(makeNextRequest('/api/tasks'))

    expect(response.status).toBe(401)
  })

  it('sets x-user-id for authenticated API routes', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => 'user-123'),
    }

    const middleware = createAuthMiddleware({ adapter })
    const response = await middleware(makeNextRequest('/api/tasks'))

    expect(response.status).toBe(200)
    expect(adapter.getUserIdFromRequest).toHaveBeenCalledOnce()
  })

  it('allows public API routes without auth', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => null),
    }

    const middleware = createAuthMiddleware({
      adapter,
      publicRoutes: ['/api/list-plans'],
    })
    const response = await middleware(makeNextRequest('/api/list-plans'))

    expect(response.status).toBe(200)
  })

  it('short-circuits when handleRequest owns the route', async () => {
    const owned = new Response('auth-route', { status: 302 })
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => null),
      handleRequest: vi.fn(async () => ({ response: owned, ownsRequest: true })),
    }

    const middleware = createAuthMiddleware({ adapter, processAllRoutes: true })
    const response = await middleware(makeNextRequest('/auth/login'))

    expect(response).toBe(owned)
  })

  it('forwards identity with claims token when getIdentityFromRequest is present', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => 'user-123'),
      getIdentityFromRequest: vi.fn(async () => ({
        userId: 'auth0|user-1',
        claimsToken: 'id.jwt.token',
      })),
    }

    const middleware = createAuthMiddleware({ adapter, processAllRoutes: true })
    const response = await middleware(makeNextRequest('/api/tasks'))

    expect(response.status).toBe(200)
    expect(adapter.getIdentityFromRequest).toHaveBeenCalledOnce()
  })

  it('merges set-cookie from handleRequest sessionResponse', async () => {
    const sessionResponse = new Response(null, {
      headers: { 'set-cookie': 'session=refreshed' },
    })
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => 'user-123'),
      handleRequest: vi.fn(async () => ({ sessionResponse, ownsRequest: false })),
    }

    const middleware = createAuthMiddleware({ adapter, processAllRoutes: true })
    const response = await middleware(makeNextRequest('/dashboard'))

    expect(response.headers.getSetCookie()).toContain('session=refreshed')
  })

  it('skips non-api routes when processAllRoutes is false', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => null),
    }

    const middleware = createAuthMiddleware({ adapter })
    const response = await middleware(makeNextRequest('/dashboard'))

    expect(response.status).toBe(200)
    expect(adapter.getUserIdFromRequest).not.toHaveBeenCalled()
  })
})
