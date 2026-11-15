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

/**
 * Every API failure carries a stable `code`, as the Python SDK's does: the
 * API's own `code` when its JSON body has one, `http_<status>` when it has
 * none, and `non_json_response` when the body is not JSON at all. The
 * conformance cases pin errors by this code.
 */
describe('createSolvaPayClient — API errors carry a stable code', () => {
  const apiKey = 'sk_test_123'
  const baseUrl = 'https://api.solvapay.com'
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the API's own code when the body has one", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json({ code: 'KEY_ENV_MISMATCH', message: 'Wrong environment' }, 403),
    )
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toMatchObject({
      status: 403,
      code: 'KEY_ENV_MISMATCH',
    })
  })

  it('uses http_<status> when the JSON body has no code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'boom' }, 500))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.checkLimits({ customerRef: 'cus_1', productRef: 'prd_1' } as never),
    ).rejects.toMatchObject({ status: 500, code: 'http_500' })
  })

  it('uses http_<status> when the code is not a non-empty string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ code: '', message: 'x' }, 422))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toMatchObject({ status: 422, code: 'http_422' })
  })

  it('uses non_json_response for a JSON content type whose body does not parse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"message": "trunc', {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toMatchObject({
      status: 502,
      code: 'non_json_response',
    })
  })

  it('keeps the human-readable message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'boom' }, 500))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toThrow(
      'Get merchant failed (500): {"message":"boom"}',
    )
  })

  it('codes a missing apiKey missing_secret', () => {
    expect(() => createSolvaPayClient({ apiKey: '' })).toThrow(
      expect.objectContaining({ code: 'missing_secret' }),
    )
  })
})

describe('createSolvaPayClient — cancelPurchase', () => {
  const apiKey = 'sk_test_123'
  const baseUrl = 'https://api.solvapay.com'
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts the reason to the cancel endpoint and returns the purchase', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        json({ success: true, purchase: { reference: 'pur_1', status: 'cancelled' } }),
      )
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    const purchase = await client.cancelPurchase!({ purchaseRef: 'pur/1', reason: 'too pricey' })

    expect(purchase).toEqual({ reference: 'pur_1', status: 'cancelled' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${baseUrl}/v1/sdk/purchases/pur%2F1/cancel`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'too pricey' })
  })

  it('sends an empty body when there is no reason', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ purchase: { reference: 'pur_1', status: 'cancelled' } }))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await client.cancelPurchase!({ purchaseRef: 'pur_1' })

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({})
  })

  it('names a 404 "Purchase not found"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'gone' }, 404))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    const error = await client.cancelPurchase!({ purchaseRef: 'pur_1' }).catch(e => e)

    expect(error).toBeInstanceOf(SolvaPayError)
    expect(error).toMatchObject({ status: 404, code: 'http_404' })
    expect(error.message).toMatch(/^Purchase not found: /)
  })

  it('names a 400 a purchase that cannot be cancelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'nope' }, 400))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    const error = await client.cancelPurchase!({ purchaseRef: 'pur_1' }).catch(e => e)

    expect(error).toMatchObject({ status: 400, code: 'http_400' })
    expect(error.message).toMatch(/^Purchase cannot be cancelled or does not belong to provider: /)
  })

  it('reports any other failure as the cancel failing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ message: 'down' }, 503))
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.cancelPurchase!({ purchaseRef: 'pur_1' })).rejects.toMatchObject({
      status: 503,
      code: 'http_503',
      message: 'Cancel purchase failed (503): {"message":"down"}',
    })
  })
})

describe('createSolvaPayClient — attachBusinessDetails', () => {
  const apiKey = 'sk_test_123'
  const baseUrl = 'https://api.solvapay.com'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('names its own operation when it fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'bad tax id' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.attachBusinessDetails!({ paymentIntentId: 'pi_1', isBusiness: false }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'http_400',
      message: 'Attach business details failed (400): {"message":"bad tax id"}',
    })
  })
})
