import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPay } from '../factory'
import { cancelPurchaseCore, reactivatePurchaseCore } from './renewal'

/**
 * `cancelPurchaseCore` / `reactivatePurchaseCore` with the SDK's own API
 * client. The caller must be a verified user, and the purchase must belong to
 * that user's customer: both act on a purchase by reference, so without the
 * check any caller could change another customer's renewal.
 *
 * The requests carry `x-user-id: cus_owner`, as the MCP server's widget tools
 * do (a `cus_` id resolves to that customer without an API call).
 */
describe('renewal helpers with the built-in API client', () => {
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
  const asOwner = () => new Request('https://app.test', { headers: { 'x-user-id': 'cus_owner' } })
  const owned = (ref = 'pur_1') => json({ reference: ref, customerRef: 'cus_owner', status: 'active' })

  it('cancels a purchase that belongs to the caller', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(owned())
      .mockResolvedValueOnce(
        json({
          success: true,
          purchase: { reference: 'pur_1', status: 'active', cancelledAt: '2026-11-12T00:00:00Z' },
        }),
      )

    const pending = cancelPurchaseCore(asOwner(), { purchaseRef: 'pur_1' }, { solvaPay: solvaPay() })
    await vi.runAllTimersAsync()

    expect(await pending).toEqual({
      reference: 'pur_1',
      status: 'active',
      cancelledAt: '2026-11-12T00:00:00Z',
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.renewal.test/v1/sdk/purchases/pur_1')
  })

  it("refuses another customer's purchase with 403, without cancelling it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ reference: 'pur_1', customerRef: 'cus_victim', status: 'active' }))

    const result = await cancelPurchaseCore(asOwner(), { purchaseRef: 'pur_1' }, { solvaPay: solvaPay() })

    expect(result).toMatchObject({ error: 'Forbidden', status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller with no verified identity with 401, before calling SolvaPay', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const result = await cancelPurchaseCore(
      new Request('https://app.test'),
      { purchaseRef: 'pur_1' },
      { solvaPay: solvaPay() },
    )

    expect(result).toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 404 when the purchase does not exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'gone' }, 404))

    const result = await cancelPurchaseCore(
      asOwner(),
      { purchaseRef: 'pur_missing' },
      { solvaPay: solvaPay() },
    )

    expect(result).toMatchObject({ status: 404 })
  })

  it('answers 400 when the purchase cannot be cancelled', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(owned())
      .mockResolvedValueOnce(json({ message: 'nope' }, 400))

    const result = await cancelPurchaseCore(asOwner(), { purchaseRef: 'pur_1' }, { solvaPay: solvaPay() })

    expect(result).toMatchObject({
      error: 'Purchase cannot be cancelled or does not belong to provider',
      status: 400,
    })
  })

  it("refuses to reactivate another customer's purchase with 403", async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ reference: 'pur_1', customerRef: 'cus_victim', status: 'active' }))

    const result = await reactivatePurchaseCore(asOwner(), { purchaseRef: 'pur_1' }, { solvaPay: solvaPay() })

    expect(result).toMatchObject({ error: 'Forbidden', status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
