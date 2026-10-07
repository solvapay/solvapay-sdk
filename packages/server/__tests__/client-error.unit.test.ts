import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSolvaPayClient } from '../src/client'
import { SolvaPayError } from '@solvapay/core'

describe('createSolvaPayClient — SolvaPayError carries upstream HTTP status', () => {
  const apiKey = 'sk_test_123'
  const baseUrl = 'https://api.solvapay.com'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves 404 status when getMerchant returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Provider not found', { status: 404 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toMatchObject({
      name: 'SolvaPayError',
      status: 404,
    })
  })

  it('preserves 401 status on checkLimits', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.checkLimits({ productRef: 'prd_1', resource: 'tool', units: 1 }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('preserves 400 status on createTopupPaymentIntent failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Bad Request', { status: 400 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.createTopupPaymentIntent!({
        customerRef: 'cus_1',
        amount: -100,
        currency: 'usd',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('preserves 404 status on getProduct', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('not found', { status: 404 }))

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getProduct('prd_missing')).rejects.toMatchObject({ status: 404 })
  })

  it('flags non-JSON HTML error pages with code non_json_response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<!DOCTYPE html><html><body>offline</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getProduct('prd_missing')).rejects.toMatchObject({
      status: 404,
      code: 'non_json_response',
    })
  })

  it('reads a keyed 402 body into code, reason and declineCode with the message as detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 402,
          error: 'payment_declined',
          message: 'Payment card_declined',
          reason: 'card_declined',
          declineCode: 'insufficient_funds',
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.confirmPayment!({
        paymentIntentId: 'pi_1',
        cardId: 'CRD1',
        returnUrl: 'https://a.test/r',
      }),
    ).rejects.toMatchObject({
      name: 'SolvaPayError',
      status: 402,
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
      message: 'Confirm payment failed (402): Payment card_declined',
    })
  })

  it('reads a keyed 409 body into code without decline fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 409,
          error: 'confirm_in_progress',
          message: 'This payment is being confirmed',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    const thrown = await client.confirmPayment!({
      paymentIntentId: 'pi_1',
      paymentMethodId: 'spm_1',
      returnUrl: 'https://a.test/r',
    }).then(
      () => undefined,
      (err: unknown) => err as SolvaPayError,
    )
    expect(thrown).toMatchObject({ status: 409, code: 'confirm_in_progress' })
    expect(thrown!.reason).toBeUndefined()
    expect(thrown!.declineCode).toBeUndefined()
  })

  it('keeps the message of a plain NestJS body and sets no code (the reason phrase is not a key)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message:
            'returnUrl must be on one of the origins of this checkout session; https://x is not',
          error: 'Bad Request',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    const thrown = await client.confirmPayment!({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://x/r',
    }).then(
      () => undefined,
      (err: unknown) => err as SolvaPayError,
    )
    expect(thrown).toMatchObject({
      status: 400,
      message:
        'Confirm payment failed (400): returnUrl must be on one of the origins of this checkout session; https://x is not',
    })
    expect(thrown!.code).toBeUndefined()
  })

  it('joins an array message from a validation body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message: ['cardId is required', 'returnUrl is required'],
          error: 'Bad Request',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.createCaptureGrant!({ paymentIntentId: 'pi_1' })).rejects.toMatchObject({
      message: 'Create capture grant failed (400): cardId is required; returnUrl is required',
    })
  })

  it('sends billingDetails with the confirm body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'pi_1', processorPaymentId: 'pi_rail_1', status: 'succeeded' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })
    const billingDetails = { name: 'Ada', address: { country: 'SE' } }

    await client.confirmPayment!({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://a.test/r',
      billingDetails,
    })

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toStrictEqual({
      cardId: 'CRD1',
      returnUrl: 'https://a.test/r',
      billingDetails,
    })
  })

  it('still throws a SolvaPayError instance (backwards compatible)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toBeInstanceOf(SolvaPayError)
  })

  it('still throws SolvaPayError without status when apiKey missing (config error)', () => {
    expect(() => createSolvaPayClient({ apiKey: '' })).toThrow(SolvaPayError)
    try {
      createSolvaPayClient({ apiKey: '' })
    } catch (e) {
      expect(e).toBeInstanceOf(SolvaPayError)
      expect((e as SolvaPayError).status).toBeUndefined()
    }
  })
})
