import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  resetWasmWebhookCache,
  resolveEdgeWebhookImpl,
  setWasmWebhookBindingForTests,
  verifyWebhookWasm,
} from '../src/webhook-wasm'

const mockVerifyWebhook = vi.fn()
const mockReady = vi.fn(async () => undefined)

const fakeBinding = {
  ready: () => mockReady() as Promise<void>,
  verifyWebhook: (...args: [string, string, string, number]) =>
    mockVerifyWebhook(...args) as string,
}

const eventBody = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_edge_impl_123',
  created: Math.floor(Date.now() / 1000),
  api_version: '2025-10-01',
  data: {
    object: { id: 'pur_edge_impl_123' },
    previous_attributes: null,
  },
  livemode: false,
  request: { id: null, idempotency_key: null },
})

describe('edge verifyWebhook impl selection', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    mockVerifyWebhook.mockReset()
    mockReady.mockClear()
    delete process.env.SOLVAPAY_IMPL
    resetWasmWebhookCache()
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    resetWasmWebhookCache()
  })

  it('resolveEdgeWebhookImpl returns ts when SOLVAPAY_IMPL=ts', () => {
    process.env.SOLVAPAY_IMPL = 'ts'
    expect(resolveEdgeWebhookImpl()).toBe('ts')
  })

  it('resolveEdgeWebhookImpl returns rust when SOLVAPAY_IMPL=rust', () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    expect(resolveEdgeWebhookImpl()).toBe('rust')
  })

  it('resolveEdgeWebhookImpl defaults to rust when unset', () => {
    expect(resolveEdgeWebhookImpl()).toBe('rust')
  })

  it('shares one init Promise while initialization is in progress', async () => {
    let resolveReady!: () => void
    const gate = new Promise<void>(r => {
      resolveReady = r
    })
    setWasmWebhookBindingForTests({
      ready: () => gate,
      verifyWebhook: fakeBinding.verifyWebhook,
    })
    mockVerifyWebhook.mockReturnValue(eventBody)

    const p1 = verifyWebhookWasm({
      body: eventBody,
      signature: 't=1,v1=deadbeef',
      secret: 'whsec_test',
    })
    const p2 = verifyWebhookWasm({
      body: eventBody,
      signature: 't=1,v1=deadbeef',
      secret: 'whsec_test',
    })

    resolveReady()
    const [a, b] = await Promise.all([p1, p2])
    expect(a.type).toBe('purchase.created')
    expect(b.type).toBe('purchase.created')
  })

  it('forwards body, signature, secret, and floor(Date.now/1000) to the binding', async () => {
    setWasmWebhookBindingForTests(fakeBinding)
    mockVerifyWebhook.mockReturnValue(eventBody)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_782_864_000_500)

    const event = await verifyWebhookWasm({
      body: eventBody,
      signature: 't=1,v1=deadbeef',
      secret: 'whsec_test',
    })

    expect(mockVerifyWebhook).toHaveBeenCalledWith(
      eventBody,
      't=1,v1=deadbeef',
      'whsec_test',
      1_782_864_000,
    )
    expect(event.type).toBe('purchase.created')
    nowSpy.mockRestore()
  })

  it('preserves Error.code as SolvaPayError code', async () => {
    setWasmWebhookBindingForTests(fakeBinding)
    const nativeErr = new Error('Invalid webhook signature') as Error & { code?: string }
    nativeErr.code = 'invalid_signature'
    mockVerifyWebhook.mockImplementation(() => {
      throw nativeErr
    })

    try {
      await verifyWebhookWasm({
        body: eventBody,
        signature: 't=1,v1=deadbeef',
        secret: 'whsec_test',
      })
      expect.unreachable('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect((err as SolvaPayError).message).toBe('Invalid webhook signature')
      expect((err as SolvaPayError).code).toBe('invalid_signature')
    }
  })

  it('stringifies non-Error throws', async () => {
    setWasmWebhookBindingForTests(fakeBinding)
    mockVerifyWebhook.mockImplementation(() => {
      throw 'boom-string'
    })

    await expect(
      verifyWebhookWasm({
        body: eventBody,
        signature: 't=1,v1=deadbeef',
        secret: 'whsec_test',
      }),
    ).rejects.toMatchObject({
      name: 'SolvaPayError',
      message: 'boom-string',
    })
  })

  it('maps malformed binding JSON to stable internal SolvaPayError', async () => {
    setWasmWebhookBindingForTests(fakeBinding)
    mockVerifyWebhook.mockReturnValue('{not-json')

    try {
      await verifyWebhookWasm({
        body: eventBody,
        signature: 't=1,v1=deadbeef',
        secret: 'whsec_test',
      })
      expect.unreachable('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SolvaPayError)
      expect(err).not.toBeInstanceOf(SyntaxError)
      expect((err as SolvaPayError).code).toBe('internal_error')
    }
  })

  it('SOLVAPAY_IMPL=rust surfaces init errors when binding is unavailable', async () => {
    process.env.SOLVAPAY_IMPL = 'rust'
    setWasmWebhookBindingForTests(null)

    await expect(
      verifyWebhookWasm({
        body: eventBody,
        signature: 't=1,v1=deadbeef',
        secret: 'whsec_test',
      }),
    ).rejects.toBeInstanceOf(SolvaPayError)
  })
})

describe('edge graph dependency assertions', () => {
  it('edge.ts and webhook-wasm.ts never import node: or server-native', () => {
    const root = resolve(__dirname, '../src')
    const files = ['edge.ts', 'webhook-wasm.ts']
    const forbiddenImport = [
      /from\s+['"]@solvapay\/server-native['"]/,
      /from\s+['"]\.\/webhook-native['"]/,
      /from\s+['"]node:/,
      /import\s*\(\s*['"]node:/,
      /require\s*\(\s*['"]node:/,
    ]
    for (const file of files) {
      const src = readFileSync(resolve(root, file), 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const pattern of forbiddenImport) {
        expect(pattern.test(code), `${file} must not match ${pattern}`).toBe(false)
      }
    }
  })
})
