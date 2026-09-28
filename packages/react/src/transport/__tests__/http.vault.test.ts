import { describe, it, expect, vi } from 'vitest'
import { createHttpTransport, DEFAULT_ROUTES } from '../http'

function makeFetch(payload: unknown) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

describe('createHttpTransport — vault checkout', () => {
  it('POSTs createCaptureGrant to /api/create-capture-grant with the payment id', async () => {
    const grant = { token: 't', tenantId: 'tnt', environment: 'sandbox', expiresAt: 1, scope: { paymentIntentId: 'pi_1' } }
    const fetchFn = makeFetch(grant)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.createCaptureGrant!({ paymentIntentId: 'pi_1' })

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DEFAULT_ROUTES.createCaptureGrant)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ paymentIntentId: 'pi_1' })
    expect(result).toEqual(grant)
  })

  it('POSTs confirmPayment to /api/confirm-payment with card id and return url', async () => {
    const fetchFn = makeFetch({ id: 'pi_1', processorPaymentId: 'pi_s', status: 'succeeded' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.confirmPayment!({ paymentIntentId: 'pi_1', cardId: 'CRD1', returnUrl: 'https://x/r' })

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DEFAULT_ROUTES.confirmPayment)
    expect(JSON.parse(init.body as string)).toEqual({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://x/r',
    })
  })

  it('honours route overrides from config.api', async () => {
    const fetchFn = makeFetch({})
    const transport = createHttpTransport({
      fetch: fetchFn as unknown as typeof fetch,
      api: { createCaptureGrant: '/custom/grant', confirmPayment: '/custom/confirm' },
    })
    await transport.createCaptureGrant!({ paymentIntentId: 'pi' })
    await transport.confirmPayment!({ paymentIntentId: 'pi', paymentMethodId: 'pm' })
    expect(fetchFn.mock.calls[0][0]).toBe('/custom/grant')
    expect(fetchFn.mock.calls[1][0]).toBe('/custom/confirm')
  })
})
