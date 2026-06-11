import { describe, expect, it, vi } from 'vitest'

const {
  middlewareHandlerMock,
  createAuthMiddlewareMock,
  createAuth0AuthAdapterMock,
  auth0Mock,
} = vi.hoisted(() => ({
  middlewareHandlerMock: vi.fn(),
  createAuthMiddlewareMock: vi.fn(() => middlewareHandlerMock),
  createAuth0AuthAdapterMock: vi.fn(() => ({ kind: 'auth0-adapter' })),
  auth0Mock: {
    middleware: vi.fn(),
    getSession: vi.fn(),
  },
}))

vi.mock('@solvapay/next/middleware', () => ({
  createAuthMiddleware: createAuthMiddlewareMock,
}))

vi.mock('@solvapay/auth/auth0', () => ({
  createAuth0AuthAdapter: createAuth0AuthAdapterMock,
}))

vi.mock('./lib/auth0', () => ({
  auth0: auth0Mock,
}))

import { proxy } from './proxy'

function makeRequest(path: string): Request {
  const url = `https://example.com${path}`
  return new Request(url)
}

describe('nextjs-auth0 proxy middleware', () => {
  it('wires Auth0 adapter into createAuthMiddleware with processAllRoutes', () => {
    expect(createAuth0AuthAdapterMock).toHaveBeenCalledWith({ auth0: auth0Mock })
    expect(createAuthMiddlewareMock).toHaveBeenCalledWith({
      adapter: { kind: 'auth0-adapter' },
      processAllRoutes: true,
    })
  })

  it('delegates incoming requests to generated middleware handler', async () => {
    middlewareHandlerMock.mockClear()
    middlewareHandlerMock.mockResolvedValue(new Response(null, { status: 200 }))

    const request = makeRequest('/api/tasks')
    const response = await proxy(request as never)

    expect(middlewareHandlerMock).toHaveBeenCalledWith(request)
    expect(response.status).toBe(200)
  })
})
