import { describe, expect, it, vi } from 'vitest'

const { middlewareHandlerMock, createAuth0AuthMiddlewareMock, auth0Mock } = vi.hoisted(() => ({
  middlewareHandlerMock: vi.fn(),
  createAuth0AuthMiddlewareMock: vi.fn(() => middlewareHandlerMock),
  auth0Mock: {
    middleware: vi.fn(),
    getSession: vi.fn(),
  },
}))

vi.mock('@solvapay/next/middleware', () => ({
  createAuth0AuthMiddleware: createAuth0AuthMiddlewareMock,
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
  it('wires auth0 into createAuth0AuthMiddleware', () => {
    expect(createAuth0AuthMiddlewareMock).toHaveBeenCalledWith({ auth0: auth0Mock })
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
