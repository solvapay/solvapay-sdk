/**
 * Local HTTP stub server for MCP async fixture replay.
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type FixtureHttpStub = {
  method?: string
  path?: string
  status?: number
  body?: unknown
}

const DEFAULT_BOOTSTRAP_STUBS: FixtureHttpStub[] = [
  {
    method: 'GET',
    path: '/v1/sdk/platform-config',
    status: 200,
    body: { stripePublishableKey: 'pk_test' },
  },
  { method: 'GET', path: '/v1/sdk/merchant', status: 200, body: { displayName: 'Acme' } },
  { method: 'GET', path: '/v1/sdk/products/prd_demo', status: 200, body: { name: 'Demo' } },
  {
    method: 'GET',
    path: '/v1/sdk/products/prd_demo/plans',
    status: 200,
    body: { plans: [{ name: 'Pro' }] },
  },
  {
    method: 'POST',
    path: '/v1/sdk/checkout-sessions',
    status: 200,
    body: { checkoutUrl: 'https://checkout.example/s', sessionId: 'cs_1' },
  },
]

export function isUnreachableExpect(expectResult: unknown): boolean {
  if (typeof expectResult !== 'object' || expectResult === null) return false
  const rec = expectResult as Record<string, unknown>
  if (rec.status !== 502) return false
  const body = rec.body
  if (typeof body !== 'object' || body === null) return false
  return (body as Record<string, unknown>).error === 'upstream_unreachable'
}

export function fixtureHttpStubs(raw: unknown, fn: string): FixtureHttpStub[] {
  if (typeof raw !== 'object' || raw === null) return []
  const rec = raw as Record<string, unknown>
  const stubs = rec.http
  if (Array.isArray(stubs) && stubs.length > 0) {
    return stubs as FixtureHttpStub[]
  }
  if (fn === 'mcpBootstrap') return DEFAULT_BOOTSTRAP_STUBS
  return []
}

export async function withFixtureHttp<T>(
  stubs: FixtureHttpStub[],
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const stub = stubs.find(item => (item.method ?? 'GET') === method && item.path === url.pathname)
    if (stub === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    res.statusCode = stub.status ?? 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(stub.body ?? {}))
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const addr = server.address() as AddressInfo
  try {
    return await run(`http://127.0.0.1:${addr.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()))
    })
  }
}
