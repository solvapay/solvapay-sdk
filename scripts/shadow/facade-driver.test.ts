import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  FACADE_SHADOW_OPERATION_NAMES,
  installFacadeDriverSession,
} from './facade-driver.js'

describe('facade shadow driver', () => {
  it('registers all 36 camelCase operations', () => {
    expect(FACADE_SHADOW_OPERATION_NAMES).toHaveLength(36)
    const session = installFacadeDriverSession({
      apiKey: 'sk_test',
      apiBaseUrl: 'http://127.0.0.1:9',
    })
    try {
      expect(new Set(session.driver.operationNames)).toEqual(
        new Set(FACADE_SHADOW_OPERATION_NAMES),
      )
    } finally {
      session.restore()
    }
  })

  it('records request/response pairs via the WASM FetchTransport', async () => {
    // The session forces the WASM facade path (Step 53); the recorder captures
    // the `fetch(request)` the WASM `FetchTransport` issues to the real server.
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ displayName: 'T', legalName: 'T LLC' }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('bind failed')
    }
    const baseUrl = `http://127.0.0.1:${address.port}`

    const session = installFacadeDriverSession({
      apiKey: 'sk_test_shadow',
      apiBaseUrl: baseUrl,
    })
    try {
      const outcome = await session.driver.invoke('getMerchant', {})
      expect(outcome.ok).toBe(true)
      expect(outcome.wire).toHaveLength(1)
      expect(outcome.wire[0]?.method).toBe('GET')
      expect(outcome.wire[0]?.url).toContain('/v1/sdk/merchant')
      expect(outcome.wire[0]?.status).toBe(200)
    } finally {
      session.restore()
      await new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve())),
      )
    }
  })
})
