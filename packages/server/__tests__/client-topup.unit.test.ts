import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSolvaPayClient } from '../src/client'
import { SolvaPayError } from '@solvapay/core'

describe('createSolvaPayClient - createTopupPaymentIntent', () => {
  const apiKey = 'sk_test_123'
  const baseUrl = 'https://api.solvapay.com'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends correct body with purpose: credit_topup to /v1/sdk/payment-intents', async () => {
    const mockResponse = {
      id: 'pi_topup_123',
      clientSecret: 'pi_topup_123_secret',
      publishableKey: 'pk_test_456',
      accountId: 'acct_789',
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })
    const result = await client.createTopupPaymentIntent!({
      customerRef: 'cus_123',
      amount: 5000,
      currency: 'usd',
      description: 'Credit top-up',
    })

    expect(result).toEqual(mockResponse)

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${baseUrl}/v1/sdk/payment-intents`)
    expect(options!.method).toBe('POST')

    const body = JSON.parse(options!.body as string)
    expect(body).toEqual({
      customerRef: 'cus_123',
      purpose: 'credit_topup',
      amount: 5000,
      currency: 'usd',
      description: 'Credit top-up',
    })
  })

  it('generates an idempotency key when none is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'pi_1', clientSecret: 'cs', publishableKey: 'pk' }), {
        status: 200,
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })
    await client.createTopupPaymentIntent!({
      customerRef: 'cus_1',
      amount: 1000,
      currency: 'usd',
    })

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]!.headers
    expect(headers['Idempotency-Key']).toMatch(/^topup-/)
  })

  it('forwards a caller-provided idempotency key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'pi_1', clientSecret: 'cs', publishableKey: 'pk' }), {
        status: 200,
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })
    await client.createTopupPaymentIntent!({
      customerRef: 'cus_1',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'my-custom-key',
    })

    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]!.headers
    expect(headers['Idempotency-Key']).toBe('my-custom-key')
  })

  it('throws SolvaPayError on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Bad Request: amount must be positive', { status: 400 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.createTopupPaymentIntent!({
        customerRef: 'cus_1',
        amount: -100,
        currency: 'usd',
      }),
    ).rejects.toThrow(SolvaPayError)

    await expect(
      client.createTopupPaymentIntent!({
        customerRef: 'cus_1',
        amount: -100,
        currency: 'usd',
      }),
    ).rejects.toThrow(/Create topup payment intent failed/)
  })

  it('omits description when not provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'pi_1', clientSecret: 'cs', publishableKey: 'pk' }), {
        status: 200,
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })
    await client.createTopupPaymentIntent!({
      customerRef: 'cus_1',
      amount: 2000,
      currency: 'eur',
    })

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]!.body as string,
    )
    expect(body.description).toBeUndefined()
    expect(body.purpose).toBe('credit_topup')
    expect(body.amount).toBe(2000)
    expect(body.currency).toBe('eur')
  })
})
