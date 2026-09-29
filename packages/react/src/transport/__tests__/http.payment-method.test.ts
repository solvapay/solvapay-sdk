import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpTransport, DEFAULT_ROUTES } from '../http'

function makeFetch(payload: unknown, status = 200) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

const removed = {
  removed: { brand: 'visa', last4: '0018', expMonth: 12, expYear: 2030 },
  autoRechargePaused: true,
}

describe('createHttpTransport — remove the card on file', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('sends DELETE /api/payment-method with no body and returns the removed card', async () => {
    const fetchFn = makeFetch(removed)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.removePaymentMethod!()

    expect(DEFAULT_ROUTES.getPaymentMethod).toBe('/api/payment-method')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/payment-method', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(result).toStrictEqual(removed)
  })

  it('uses the configured getPaymentMethod route', async () => {
    const fetchFn = makeFetch(removed)
    const transport = createHttpTransport({
      fetch: fetchFn as unknown as typeof fetch,
      api: { getPaymentMethod: '/billing/card' },
    })

    await transport.removePaymentMethod!()

    expect(fetchFn.mock.calls.map(call => [call[0], call[1].method])).toStrictEqual([
      ['/billing/card', 'DELETE'],
    ])
  })

  it('rejects with the route error and reports it through onError', async () => {
    const onError = vi.fn()
    const fetchFn = makeFetch({ error: 'No card on file' }, 404)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch, onError })

    await expect(transport.removePaymentMethod!()).rejects.toThrow('No card on file')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toBe('removePaymentMethod')
  })
})
