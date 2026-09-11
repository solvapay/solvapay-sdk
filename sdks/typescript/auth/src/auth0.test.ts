import { describe, expect, it, vi } from 'vitest'

import { createAuth0AuthAdapter, mergeSetCookies, type Auth0ClientLike } from './auth0'

function makeRequest(path: string): Request {
  return new Request(`https://example.com${path}`)
}

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

describe('createAuth0AuthAdapter', () => {
  it('handleRequest owns /auth routes', async () => {
    const auth0 = makeAuth0()
    const adapter = createAuth0AuthAdapter({ auth0 })

    const result = await adapter.handleRequest?.(makeRequest('/auth/login'))

    expect(result?.ownsRequest).toBe(true)
    expect(result?.response).toBeInstanceOf(Response)
    expect(auth0.middleware).toHaveBeenCalledOnce()
  })

  it('handleRequest returns sessionResponse for non-auth routes', async () => {
    const auth0 = makeAuth0()
    const adapter = createAuth0AuthAdapter({ auth0 })

    const result = await adapter.handleRequest?.(makeRequest('/dashboard'))

    expect(result?.ownsRequest).toBe(false)
    expect(result?.sessionResponse).toBeInstanceOf(Response)
  })

  it('getIdentityFromRequest returns sub and id token', async () => {
    const adapter = createAuth0AuthAdapter({ auth0: makeAuth0() })

    const identity = await adapter.getIdentityFromRequest?.(makeRequest('/api/tasks'))

    expect(identity).toEqual({ userId: 'auth0|user-1', claimsToken: 'id.jwt.token' })
  })

  it('getIdentityFromRequest returns null when unauthenticated', async () => {
    const auth0 = makeAuth0({
      getSession: vi.fn(async () => null),
    })
    const adapter = createAuth0AuthAdapter({ auth0 })

    const identity = await adapter.getIdentityFromRequest?.(makeRequest('/api/tasks'))

    expect(identity).toBeNull()
  })

  it('getUserIdFromRequest returns sub only', async () => {
    const adapter = createAuth0AuthAdapter({ auth0: makeAuth0() })

    const userId = await adapter.getUserIdFromRequest(makeRequest('/api/tasks'))

    expect(userId).toBe('auth0|user-1')
  })
})

describe('mergeSetCookies', () => {
  it('copies set-cookie headers from source to target', () => {
    const target = new Response()
    const source = new Response()
    source.headers.append('set-cookie', 'a=1')
    source.headers.append('set-cookie', 'b=2')

    mergeSetCookies(target, source)

    expect(target.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
  })
})
