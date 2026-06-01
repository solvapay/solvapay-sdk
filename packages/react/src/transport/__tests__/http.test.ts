import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpTransport, DEFAULT_ROUTES } from '../http'

function makeFetch(payload: unknown, init: { status?: number } = {}) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

describe('createHttpTransport — default routes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['checkPurchase', DEFAULT_ROUTES.checkPurchase, 'GET'] as const,
    ['getMerchant', DEFAULT_ROUTES.getMerchant, 'GET'] as const,
    ['getBalance', DEFAULT_ROUTES.customerBalance, 'GET'] as const,
    ['createCustomerSession', DEFAULT_ROUTES.createCustomerSession, 'POST'] as const,
  ])('%s → %s (%s)', async (method, route, httpMethod) => {
    const fetchFn = makeFetch({})
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (transport as any)[method]()

    expect(fetchFn).toHaveBeenCalledWith(route, expect.objectContaining({ method: httpMethod }))
  })

  it('POSTs createPayment body with only defined fields', async () => {
    const fetchFn = makeFetch({ clientSecret: 'cs_x', publishableKey: 'pk_x' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.createPayment({ planRef: 'pln_pro', productRef: undefined, customer: {} })

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ planRef: 'pln_pro' })
  })

  it('honours config.api overrides', async () => {
    const fetchFn = makeFetch({})
    const transport = createHttpTransport({
      fetch: fetchFn as unknown as typeof fetch,
      api: { getMerchant: '/custom/merchant', createCheckoutSession: '/custom/checkout' },
    })

    await transport.getMerchant!()
    await transport.createCheckoutSession({ productRef: 'prd_api' })

    expect(fetchFn).toHaveBeenNthCalledWith(1, '/custom/merchant', expect.any(Object))
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/custom/checkout', expect.any(Object))
  })

  it('appends productRef query param to getProduct + listPlans', async () => {
    const fetchFn = makeFetch({})
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.getProduct!('prd with spaces')
    await transport.listPlans!('prd_api')

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      `${DEFAULT_ROUTES.getProduct}?productRef=prd%20with%20spaces`,
      expect.any(Object),
    )
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      `${DEFAULT_ROUTES.listPlans}?productRef=prd_api`,
      expect.any(Object),
    )
  })

  it('listPlans unwraps `{ plans }` to Plan[]', async () => {
    const plans = [
      { reference: 'pln_a', price: 0, currency: 'USD' },
      { reference: 'pln_b', price: 999, currency: 'USD' },
    ]
    const fetchFn = makeFetch({ plans, productRef: 'prd_api' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.listPlans!('prd_api')

    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual(plans)
  })

  it('listPlans returns [] when wire payload omits `plans`', async () => {
    const fetchFn = makeFetch({})
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.listPlans!('prd_api')

    expect(result).toEqual([])
  })

  it('getLimits encodes productRef + meterName as query params', async () => {
    const fetchFn = makeFetch({ withinLimits: true, remaining: 12, meterName: 'requests' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.getLimits!({ productRef: 'prd_api', meterName: 'tokens' })

    expect(fetchFn).toHaveBeenCalledWith(
      `${DEFAULT_ROUTES.getLimits}?productRef=prd_api&meterName=tokens`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getLimits omits meterName when undefined', async () => {
    const fetchFn = makeFetch({ withinLimits: true, remaining: 5, meterName: 'requests' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.getLimits!({ productRef: 'prd_api' })

    expect(fetchFn).toHaveBeenCalledWith(
      `${DEFAULT_ROUTES.getLimits}?productRef=prd_api`,
      expect.any(Object),
    )
  })

  it('getLimits projects the wire response down to TransportLimitsResult', async () => {
    // The backend returns the full LimitResponseWithPlan; the transport
    // strips everything but the projection consumed by useLimits.
    const fetchFn = makeFetch({
      withinLimits: false,
      remaining: 0,
      meterName: 'requests',
      checkoutUrl: 'https://pay.example.com/co',
      plans: [{ reference: 'pln_pro' }],
      balance: { creditBalance: 0 },
    })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.getLimits!({ productRef: 'prd_api' })

    expect(result).toEqual({
      withinLimits: false,
      remaining: 0,
      meterName: 'requests',
      activationRequired: false,
    })
  })

  it('getLimits maps an absent meterName on the wire to null', async () => {
    const fetchFn = makeFetch({ withinLimits: true, remaining: 3 })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.getLimits!({ productRef: 'prd_api' })

    expect(result.meterName).toBeNull()
  })

  it('getLimits passes through `activationRequired: true` when the backend reports it', async () => {
    const fetchFn = makeFetch({
      withinLimits: false,
      remaining: 0,
      meterName: 'requests',
      activationRequired: true,
    })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.getLimits!({ productRef: 'prd_api' })

    expect(result.activationRequired).toBe(true)
  })

  it('getLimits defaults `activationRequired` to false when the wire field is absent', async () => {
    const fetchFn = makeFetch({ withinLimits: true, remaining: 5, meterName: 'requests' })
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.getLimits!({ productRef: 'prd_api' })

    expect(result.activationRequired).toBe(false)
  })

  it('throws with backend error message when response is not ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await expect(transport.checkPurchase!()).rejects.toThrow('Customer not found')
  })

  it('falls back to statusText when response has no JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
    )
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await expect(transport.checkPurchase!()).rejects.toThrow(/Internal Server Error|Failed to check purchase/)
  })

  it('invokes config.onError with the right context key on failure', async () => {
    const onError = vi.fn()
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }),
    )
    const transport = createHttpTransport({
      fetch: fetchFn as unknown as typeof fetch,
      onError,
    })

    await expect(transport.getBalance!()).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'getBalance')
  })
})
