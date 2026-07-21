import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateBusinessDetails } from './native-core'
import { resetBrowserCoreWasmForTests, warmBrowserCoreWasm } from './browser-wasm'

// Fake public-safe browser binding: `ready()` resolves, and each envelope fn
// returns a sentinel so we can prove dispatch flipped from TS to WASM.
const readyMock = vi.fn(async () => undefined)
const validateBusinessDetailsMock = vi.fn((_argsJson: string) =>
  JSON.stringify({ ok: true, value: { valid: true, sentinel: 'from-wasm' } }),
)

vi.mock('@solvapay/server-wasm/browser', () => ({
  ready: () => readyMock(),
  validateBusinessDetails: (argsJson: string) => validateBusinessDetailsMock(argsJson),
}))

describe('warmBrowserCoreWasm (Step 38R-e)', () => {
  afterEach(() => {
    resetBrowserCoreWasmForTests()
    readyMock.mockClear()
    validateBusinessDetailsMock.mockClear()
  })

  it('uses the TS fallback before warm-up', () => {
    const result = validateBusinessDetails({
      isBusiness: true,
      country: 'US',
      businessName: 'Acme',
      taxId: '12-3456789',
    })
    // Real TS validator returns a structured result, not the WASM sentinel.
    expect(result).not.toMatchObject({ sentinel: 'from-wasm' })
  })

  it('routes core sync logic to WASM after warm-up, and reverts on reset', async () => {
    await warmBrowserCoreWasm()
    expect(readyMock).toHaveBeenCalledTimes(1)

    const warm = validateBusinessDetails({
      isBusiness: true,
      country: 'US',
      businessName: 'Acme',
      taxId: '12-3456789',
    })
    expect(warm).toEqual({ valid: true, sentinel: 'from-wasm' })
    expect(validateBusinessDetailsMock).toHaveBeenCalledTimes(1)

    resetBrowserCoreWasmForTests()
    const cold = validateBusinessDetails({
      isBusiness: true,
      country: 'US',
      businessName: 'Acme',
      taxId: '12-3456789',
    })
    expect(cold).not.toMatchObject({ sentinel: 'from-wasm' })
  })

  it('is idempotent — a second warm-up does not re-instantiate', async () => {
    await warmBrowserCoreWasm()
    await warmBrowserCoreWasm()
    expect(readyMock).toHaveBeenCalledTimes(1)
  })
})
