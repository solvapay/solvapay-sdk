/**
 * Engine-mode `resources/read` for the widget URI. Without the host
 * short-circuit this path returned `-32603` because `mcpDispatch` cannot
 * serve the vendored HTML.
 */
import { describe, expect, it } from 'vitest'
import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayMcpFetch } from '../../src/fetch/createSolvaPayMcpFetch'

const publicBaseUrl = 'https://app.example.com'
const resourceUri = 'ui://widget.html'
const widgetHtml = '<!doctype html><html><body id="root"></body></html>'

function buildHandler() {
  const solvaPay = createSolvaPay({ apiKey: 'sk_test_fixture', apiBaseUrl: 'http://127.0.0.1:1' })
  return createSolvaPayMcpFetch({
    solvaPay,
    productRef: 'prd_demo',
    publicBaseUrl,
    apiBaseUrl: 'http://127.0.0.1:1',
    resourceUri,
    responseMode: 'json',
    requireAuth: false,
    readHtml: async () => widgetHtml,
  })
}

async function readWidget(modern: boolean): Promise<Record<string, unknown>> {
  const handler = buildHandler()
  const params: Record<string, unknown> = { uri: resourceUri }
  if (modern) {
    params._meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    }
  }
  const response = await handler(
    new Request(`${publicBaseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params,
      }),
    }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

describe('createSolvaPayMcpFetch engine-mode widget resources/read', () => {
  it('returns HTML without catalog stamps in the legacy era', async () => {
    const body = await readWidget(false)
    expect(body.error).toBeUndefined()
    const result = body.result as Record<string, unknown>
    const contents = result.contents as Array<Record<string, unknown>>
    expect(contents[0]?.text).toBe(widgetHtml)
    expect(result.resultType).toBeUndefined()
    expect(result.ttlMs).toBeUndefined()
    expect(result.cacheScope).toBeUndefined()
  })

  it('returns HTML plus resultType in the modern era', async () => {
    const body = await readWidget(true)
    expect(body.error).toBeUndefined()
    const result = body.result as Record<string, unknown>
    const contents = result.contents as Array<Record<string, unknown>>
    expect(contents[0]?.text).toBe(widgetHtml)
    expect(result.resultType).toBe('complete')
    expect(result.ttlMs).toBe(60_000)
    expect(result.cacheScope).toBe('public')
  })
})
