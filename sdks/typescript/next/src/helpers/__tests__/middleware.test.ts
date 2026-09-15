import type { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import type { AuthAdapter } from '@solvapay/auth'
import type { Auth0ClientLike } from '@solvapay/auth/auth0'
import { createAuth0AuthMiddleware, createAuthMiddleware } from '../middleware'

function makeNextRequest(path: string, headers?: HeadersInit): NextRequest {
  const url = `https://example.com${path}`
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers(headers),
  } as NextRequest
}

/** Reads the request header value the middleware forwards downstream. */
function forwardedRequestHeader(response: { headers: Headers }, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`)
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

  it('does not forward a client-supplied x-user-id on public routes', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => null),
    }

    const middleware = createAuthMiddleware({
      adapter,
      publicRoutes: ['/api/list-plans'],
    })
    const response = await middleware(
      makeNextRequest('/api/list-plans', { 'x-user-id': 'auth0|attacker' }),
    )

    expect(response.status).toBe(200)
    expect(forwardedRequestHeader(response, 'x-user-id')).toBeNull()
  })

  it('overrides a spoofed x-user-id with the verified identity', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => 'auth0|real-user'),
    }

    const middleware = createAuthMiddleware({ adapter })
    const response = await middleware(
      makeNextRequest('/api/tasks', { 'x-user-id': 'auth0|attacker' }),
    )

    expect(response.status).toBe(200)
    expect(forwardedRequestHeader(response, 'x-user-id')).toBe('auth0|real-user')
  })

  it('strips a spoofed authorization header when identity carries no claims token', async () => {
    const adapter: AuthAdapter = {
      getUserIdFromRequest: vi.fn(async () => 'auth0|real-user'),
    }

    const middleware = createAuthMiddleware({ adapter })
    const response = await middleware(
      makeNextRequest('/api/tasks', { authorization: 'Bearer attacker-token' }),
    )

    expect(response.status).toBe(200)
    expect(forwardedRequestHeader(response, 'authorization')).toBeNull()
  })
})

function makeAuth0(overrides?: Partial<Auth0ClientLike>): Auth0ClientLike {
  return {
    middleware: vi.fn(async () => new Response(null, { headers: { 'set-cookie': 'session=abc' } })),
    getSession: vi.fn(async () => ({
      user: { sub: 'auth0|user-1' },
      tokenSet: { idToken: 'id.jwt.token' },
    })),
    ...overrides,
  }
}

describe('createAuth0AuthMiddleware', () => {
  it('forwards user id and claims token for authenticated protected routes', async () => {
    const auth0 = makeAuth0()
    const middleware = createAuth0AuthMiddleware({ auth0 })
    const response = await middleware(makeNextRequest('/api/tasks'))

    expect(response.status).toBe(200)
    expect(auth0.middleware).toHaveBeenCalledOnce()
    expect(auth0.getSession).toHaveBeenCalledOnce()
    expect(response.headers.getSetCookie()).toContain('session=abc')
  })

  it('short-circuits auth0-owned auth routes', async () => {
    const auth0 = makeAuth0({
      middleware: vi.fn(async () => new Response('redirect', { status: 302 })),
    })
    const middleware = createAuth0AuthMiddleware({ auth0 })
    const response = await middleware(makeNextRequest('/auth/login'))

    expect(response.status).toBe(302)
    expect(auth0.middleware).toHaveBeenCalledOnce()
    expect(auth0.getSession).not.toHaveBeenCalled()
  })

  it('honors custom authRoutePrefix', async () => {
    const auth0 = makeAuth0({
      middleware: vi.fn(async () => new Response('custom', { status: 302 })),
    })
    const middleware = createAuth0AuthMiddleware({
      auth0,
      authRoutePrefix: '/api/auth',
    })
    const response = await middleware(makeNextRequest('/api/auth/login'))

    expect(response.status).toBe(302)
    expect(auth0.middleware).toHaveBeenCalledOnce()
    expect(auth0.getSession).not.toHaveBeenCalled()
  })

  it('returns 401 for unauthenticated protected api routes', async () => {
    const auth0 = makeAuth0({
      getSession: vi.fn(async () => null),
    })
    const middleware = createAuth0AuthMiddleware({ auth0 })
    const response = await middleware(makeNextRequest('/api/tasks'))

    expect(response.status).toBe(401)
    expect(auth0.middleware).toHaveBeenCalledOnce()
    expect(response.headers.getSetCookie()).toContain('session=abc')
  })

  it('does not enforce 401 for unauthenticated non-api routes', async () => {
    const auth0 = makeAuth0({
      getSession: vi.fn(async () => null),
    })
    const middleware = createAuth0AuthMiddleware({ auth0 })
    const response = await middleware(makeNextRequest('/dashboard'))

    expect(response.status).toBe(200)
    expect(auth0.middleware).toHaveBeenCalledOnce()
    expect(response.headers.getSetCookie()).toContain('session=abc')
  })

  it('respects publicRoutes under protected prefix', async () => {
    const auth0 = makeAuth0({
      getSession: vi.fn(async () => null),
    })
    const middleware = createAuth0AuthMiddleware({
      auth0,
      publicRoutes: ['/api/list-plans'],
    })
    const response = await middleware(makeNextRequest('/api/list-plans'))

    expect(response.status).toBe(200)
    expect(auth0.middleware).toHaveBeenCalledOnce()
    expect(response.headers.getSetCookie()).toContain('session=abc')
  })
})
