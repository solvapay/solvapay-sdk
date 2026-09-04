import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateBusinessDetails } from './native-core'
import {
  resetBrowserCoreWasmForTests,
  warmBrowserCoreWasm,
  whenBrowserCoreWasmReady,
} from './browser-wasm'

// Fake public-safe browser binding: `ready()` resolves, and each envelope fn
// returns a sentinel so we can prove dispatch flipped to WASM.
const readyMock = vi.fn(async () => undefined)
const ensureReadySyncMock = vi.fn(() => {
  throw new Error('no precompiled module in unit test')
})
const validateBusinessDetailsMock = vi.fn((_argsJson: string) =>
  JSON.stringify({ ok: true, value: { valid: true, sentinel: 'from-wasm' } }),
)

vi.mock('@solvapay/server-wasm/browser', () => ({
  ready: () => readyMock(),
  ensureReadySync: () => ensureReadySyncMock(),
  validateBusinessDetails: (argsJson: string) => validateBusinessDetailsMock(argsJson),
}))

describe('browser-wasm eager install (Step 52)', () => {
  afterEach(() => {
    resetBrowserCoreWasmForTests()
    readyMock.mockClear()
    ensureReadySyncMock.mockClear()
    validateBusinessDetailsMock.mockClear()
  })

  it('throws before the eager install completes (no TS fallback)', () => {
    resetBrowserCoreWasmForTests()
    expect(() =>
      validateBusinessDetails({
        isBusiness: true,
        country: 'US',
        businessName: 'Acme',
        taxId: '12-3456789',
      }),
    ).toThrow('core sync API not installed')
  })

  it('eager path installs dispatch without an explicit warmBrowserCoreWasm call', async () => {
    // Re-trigger warm via the public API (same promise cache as import-time eager).
    await whenBrowserCoreWasmReady().catch(() => warmBrowserCoreWasm())
    await warmBrowserCoreWasm()
    expect(readyMock).toHaveBeenCalled()

    const warm = validateBusinessDetails({
      isBusiness: true,
      country: 'US',
      businessName: 'Acme',
      taxId: '12-3456789',
    })
    expect(warm).toEqual({ valid: true, sentinel: 'from-wasm' })
    expect(validateBusinessDetailsMock).toHaveBeenCalled()
  })

  it('routes core sync logic to WASM after warm-up, and reverts on reset', async () => {
    await warmBrowserCoreWasm()
    expect(readyMock).toHaveBeenCalled()

    const warm = validateBusinessDetails({
      isBusiness: true,
      country: 'US',
      businessName: 'Acme',
      taxId: '12-3456789',
    })
    expect(warm).toEqual({ valid: true, sentinel: 'from-wasm' })

    resetBrowserCoreWasmForTests()
    expect(() =>
      validateBusinessDetails({
        isBusiness: true,
        country: 'US',
        businessName: 'Acme',
        taxId: '12-3456789',
      }),
    ).toThrow('core sync API not installed')
  })

  it('is idempotent — a second warm-up does not re-instantiate', async () => {
    await warmBrowserCoreWasm()
    const callsAfterFirst = readyMock.mock.calls.length
    await warmBrowserCoreWasm()
    expect(readyMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('explicit warm rejects when browser WASM init fails (retryable)', async () => {
    readyMock.mockRejectedValueOnce(new Error('simulated fetch(file://) failure'))
    await expect(warmBrowserCoreWasm()).rejects.toThrow(/simulated fetch/)
    // Rejection clears the cache so a later warm can succeed.
    await warmBrowserCoreWasm()
    expect(readyMock).toHaveBeenCalled()
  })

  it('eager module import swallows a rejecting browser WASM (no unhandled rejection)', async () => {
    vi.resetModules()
    vi.doMock('@solvapay/server-wasm/browser', () => ({
      ready: async () => {
        throw new Error('simulated fetch(file://) failure')
      },
      ensureReadySync: () => {
        throw new Error('no precompiled module in unit test')
      },
      validateBusinessDetails: () => JSON.stringify({ ok: true, value: {} }),
    }))

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await import('./browser-wasm')
      // Flush microtasks / promise reactions from the eager void call.
      await new Promise<void>(resolve => {
        setImmediate(resolve)
      })
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
