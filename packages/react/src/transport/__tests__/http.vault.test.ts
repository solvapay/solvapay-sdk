import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpTransport, DEFAULT_ROUTES } from '../http'
import { TransportError } from '../errors'

function makeFetch(payload: unknown, status = 200) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        statusText: status === 200 ? 'OK' : 'Bad Request',
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

const grant = {
  token: 'vgs-collect-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox',
  expiresAt: 1_800_000_000_000,
  scope: { paymentIntentId: 'pi_1' },
}

describe('createHttpTransport — vault checkout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('POSTs createCaptureGrant to /api/create-capture-grant with the payment id and returns the grant', async () => {
    const fetchFn = makeFetch(grant)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.createCaptureGrant!({ paymentIntentId: 'pi_1' })

    expect(DEFAULT_ROUTES.createCaptureGrant).toBe('/api/create-capture-grant')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/create-capture-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId: 'pi_1' }),
    })
    expect(result).toStrictEqual(grant)
  })

  it('POSTs confirmPayment to /api/confirm-payment with card id and return url and returns the payment', async () => {
    const payment = { id: 'pi_1', processorPaymentId: 'pi_s', status: 'succeeded' }
    const fetchFn = makeFetch(payment)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.confirmPayment!({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://x/r',
    })

    expect(DEFAULT_ROUTES.confirmPayment).toBe('/api/confirm-payment')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId: 'pi_1', cardId: 'CRD1', returnUrl: 'https://x/r' }),
    })
    expect(result).toStrictEqual(payment)
  })

  it('POSTs confirmPayment with a saved payment method and no return url', async () => {
    const fetchFn = makeFetch({ id: 'pi_1', processorPaymentId: 'pi_s', status: 'succeeded' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.confirmPayment!({ paymentIntentId: 'pi_1', paymentMethodId: 'pm_1' })

    expect(fetchFn).toHaveBeenCalledWith('/api/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"paymentIntentId":"pi_1","paymentMethodId":"pm_1"}',
    })
  })

  it('sends the auth bearer token and custom headers on vault calls', async () => {
    const fetchFn = makeFetch(grant)
    const transport = createHttpTransport({
      fetch: fetchFn as unknown as typeof fetch,
      auth: { adapter: { getToken: async () => 'jwt-abc', getUserId: async () => 'user_1' } },
      headers: async () => ({ 'x-solvapay-app': 'demo' }),
    })

    await transport.createCaptureGrant!({ paymentIntentId: 'pi_1' })

    expect(fetchFn).toHaveBeenCalledWith('/api/create-capture-grant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-abc',
        'x-solvapay-app': 'demo',
      },
      body: '{"paymentIntentId":"pi_1"}',
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
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn).toHaveBeenNthCalledWith(1, '/custom/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"paymentIntentId":"pi"}',
    })
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/custom/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"paymentIntentId":"pi","paymentMethodId":"pm"}',
    })
  })

  it('throws the server error message on a non-OK grant response and reports it to config.onError', async () => {
    const fetchFn = makeFetch({ error: 'Capture grant limit reached' }, 429)
    const onError = vi.fn()
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch, onError })

    await expect(transport.createCaptureGrant!({ paymentIntentId: 'pi_1' })).rejects.toThrow(
      'Capture grant limit reached',
    )
    expect(onError).toHaveBeenCalledTimes(1)
    const [reported, context] = onError.mock.calls[0]
    expect(context).toBe('createCaptureGrant')
    expect(reported).toBeInstanceOf(TransportError)
    expect(reported).toMatchObject({ message: 'Capture grant limit reached', status: 429 })
    expect(reported.code).toBeUndefined()
  })

  it('throws a TransportError carrying the key, reason and decline code of a 402 confirm', async () => {
    const fetchFn = makeFetch(
      {
        error: 'Confirm payment failed (402): Payment card_declined',
        details: 'Confirm payment failed (402): Payment card_declined',
        code: 'payment_declined',
        reason: 'card_declined',
        declineCode: 'insufficient_funds',
      },
      402,
    )
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const thrown = await transport.confirmPayment!({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
    }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(thrown).toBeInstanceOf(TransportError)
    expect(thrown).toMatchObject({
      status: 402,
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
      message: 'Confirm payment failed (402): Payment card_declined',
    })
  })

  it('sends billingDetails with the confirm body', async () => {
    const fetchFn = makeFetch({ id: 'pi_1', processorPaymentId: 'pi_rail_1', status: 'succeeded' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })
    const billingDetails = { name: 'Ada', address: { country: 'SE', postalCode: '111 22' } }

    await transport.confirmPayment!({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/return',
      billingDetails,
    })

    const [, init] = fetchFn.mock.calls[0]
    expect(JSON.parse(init.body as string)).toStrictEqual({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/return',
      billingDetails,
    })
  })

  it('falls back to the prefixed status text when a failed confirm has no error body', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 502, statusText: 'Bad Gateway' }))
    const onError = vi.fn()
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch, onError })

    await expect(
      transport.confirmPayment!({ paymentIntentId: 'pi_1', cardId: 'CRD1' }),
    ).rejects.toThrow('Failed to confirm payment: Bad Gateway')
    const [reported, context] = onError.mock.calls[0]
    expect(context).toBe('confirmPayment')
    expect(reported).toBeInstanceOf(TransportError)
    expect(reported).toMatchObject({
      message: 'Failed to confirm payment: Bad Gateway',
      status: 502,
    })
  })
})
