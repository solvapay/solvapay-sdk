import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPay } from '../factory'
import { cancelPurchaseCore } from './renewal'

/**
 * `cancelPurchaseCore` with the SDK's own API client: `cancelPurchase` went
 * missing from the client in 2.10.0, so every cancel answered 500
 * "Cancel purchase method not available on SDK client".
 */
describe('cancelPurchaseCore with the built-in API client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const solvaPay = () =>
    createSolvaPay({ apiKey: 'sk_test_renewal', apiBaseUrl: 'https://api.renewal.test' })

  it('cancels the purchase', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json({
        success: true,
        purchase: { reference: 'pur_1', status: 'active', cancelledAt: '2026-11-12T00:00:00Z' },
      }),
    )

    const pending = cancelPurchaseCore(
      new Request('https://app.test'),
      { purchaseRef: 'pur_1' },
      { solvaPay: solvaPay() },
    )
    await vi.runAllTimersAsync()

    expect(await pending).toEqual({
      reference: 'pur_1',
      status: 'active',
      cancelledAt: '2026-11-12T00:00:00Z',
    })
  })

  it('answers 404 when the purchase does not exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'gone' }, 404))

    const result = await cancelPurchaseCore(
      new Request('https://app.test'),
      { purchaseRef: 'pur_missing' },
      { solvaPay: solvaPay() },
    )

    expect(result).toMatchObject({ error: 'Purchase not found', status: 404 })
  })

  it('answers 400 when the purchase cannot be cancelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'nope' }, 400))

    const result = await cancelPurchaseCore(
      new Request('https://app.test'),
      { purchaseRef: 'pur_1' },
      { solvaPay: solvaPay() },
    )

    expect(result).toMatchObject({
      error: 'Purchase cannot be cancelled or does not belong to provider',
      status: 400,
    })
  })
})
