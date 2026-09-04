/**
 * HTTP-engine replay of dispatch/ and oauth-proxy/ MCP fixtures through
 * `createSolvaPayMcpFetch` (JSON `mcpDispatch` loop). Skips
 * invoke-handler.json — the host must run the merchant handler.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayMcpFetch } from '../src/fetch/createSolvaPayMcpFetch'

const ROOT = path.join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../contract/mcp-fixtures',
)

const HTTP_ENGINE_FIXTURES = [
  'dispatch/challenge.json',
  'dispatch/rpc.json',
  'oauth-proxy/authorize.json',
  'oauth-proxy/discovery-authorization-server.json',
  'oauth-proxy/discovery-post-405.json',
  'oauth-proxy/discovery-protected-resource.json',
  'oauth-proxy/openid-404.json',
  'oauth-proxy/paths-override.json',
  'oauth-proxy/register-502.json',
  'oauth-proxy/token-502.json',
] as const

function loadFixture(rel: string): {
  input: { fn: string; args: Record<string, unknown> }
  expect: { result: Record<string, unknown> }
  http?: Array<Record<string, unknown>>
} {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')) as ReturnType<typeof loadFixture>
}

function startStub(
  stubs: Array<Record<string, unknown>>,
): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/'
      const method = req.method ?? 'GET'
      const stub = stubs.find(item => {
        const pathMatch = typeof item.path === 'string' ? url.startsWith(String(item.path)) : true
        const methodMatch = item.method === undefined || item.method === method
        return pathMatch && methodMatch
      })
      const status = typeof stub?.status === 'number' ? stub.status : 200
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(stub?.body ?? {}))
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('stub server has no address'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => {
          server.close()
        },
      })
    })
  })
}

describe('HTTP engine fixture replay', () => {
  const closers: Array<() => void> = []
  afterAll(() => {
    for (const close of closers) close()
  })

  it.each(HTTP_ENGINE_FIXTURES.filter(rel => !rel.endsWith('invoke-handler.json')))(
    'replays %s through createSolvaPayMcpFetch',
    async rel => {
      if (rel.endsWith('invoke-handler.json')) return
      const fixture = loadFixture(rel)
      const fn = fixture.input.fn
      const args = fixture.input.args
      const expectResult = fixture.expect.result
      const unreachable =
        expectResult.status === 502 &&
        typeof expectResult.body === 'object' &&
        expectResult.body !== null &&
        (expectResult.body as { error?: unknown }).error === 'upstream_unreachable'
      let base = 'http://127.0.0.1:1'
      const stubs = fixture.http ?? []
      if (!unreachable && stubs.length > 0) {
        const stub = await startStub(stubs)
        closers.push(stub.close)
        base = stub.url
      }
      const solvaPay = createSolvaPay({ apiKey: 'sk_test_fixture', apiBaseUrl: base })
      const config = (args.config ?? {}) as Record<string, unknown>
      const publicBaseUrl = String(config.publicBaseUrl ?? 'https://app.example.com')
      const oauthPaths =
        typeof config.oauthPaths === 'object' && config.oauthPaths !== null
          ? (config.oauthPaths as Record<string, string>)
          : undefined
      const handler = createSolvaPayMcpFetch({
        solvaPay,
        productRef: String(config.productRef ?? 'prd_demo'),
        publicBaseUrl,
        apiBaseUrl: base,
        resourceUri: String(config.resourceUri ?? 'ui://test/view.html'),
        mcpPath: String(config.mcpPath ?? '/mcp'),
        responseMode: 'json',
        requireAuth: true,
        readHtml: async () => '<html></html>',
        ...(oauthPaths !== undefined ? { oauthPaths } : {}),
      })
      if (fn === 'mcpDispatch') {
        const rpc = args.rpc
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (typeof args.authHeader === 'string' && args.authHeader.length > 0) {
          headers.authorization = args.authHeader
        }
        const response = await handler(
          new Request(`${publicBaseUrl}/mcp`, {
            method: 'POST',
            headers,
            body: JSON.stringify(rpc),
          }),
        )
        if (expectResult.kind === 'challenge') {
          expect(response.status).toBe(expectResult.status)
          expect(await response.json()).toEqual(expectResult.body)
          return
        }
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(expectResult.rpc)
        return
      }
      const method = String(args.method ?? 'GET')
      const reqPath = String(args.path ?? '/')
      const headers = (args.headers ?? {}) as Record<string, string>
      const body = typeof args.body === 'string' && args.body.length > 0 ? args.body : undefined
      const response = await handler(
        new Request(`${publicBaseUrl}${reqPath}`, { method, headers, body }),
      )
      expect(response.status).toBe(expectResult.status)
      if (fn !== 'mcpOauthRequest') return
      if (typeof expectResult.headers === 'object' && expectResult.headers) {
        const want = expectResult.headers as Record<string, string>
        for (const [key, value] of Object.entries(want)) {
          const got = response.headers.get(key)
          if (key.toLowerCase() === 'location' && rel.includes('authorize')) {
            expect(got ?? '').toMatch(/\/v1\/customer\/auth\/authorize\?client_id=abc$/)
            continue
          }
          expect(got).toBe(value)
        }
      }
      const text = await response.text()
      let parsed: unknown = text
      try {
        parsed = text.length > 0 ? JSON.parse(text) : null
      } catch {
        parsed = text.length > 0 ? text : null
      }
      if (expectResult.body !== undefined) {
        expect(parsed).toEqual(expectResult.body)
      }
    },
  )
})
