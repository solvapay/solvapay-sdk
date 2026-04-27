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

    await transport.getMerchant()
    await transport.createCheckoutSession({ productRef: 'prd_api' })

    expect(fetchFn).toHaveBeenNthCalledWith(1, '/custom/merchant', expect.any(Object))
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/custom/checkout', expect.any(Object))
  })

  it('appends productRef query param to getProduct + listPlans', async () => {
    const fetchFn = makeFetch({})
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await transport.getProduct('prd with spaces')
    await transport.listPlans('prd_api')

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

  it('throws with backend error message when response is not ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await expect(transport.checkPurchase()).rejects.toThrow('Customer not found')
  })

  it('falls back to statusText when response has no JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
    )
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    await expect(transport.checkPurchase()).rejects.toThrow(/Internal Server Error|Failed to check purchase/)
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

    await expect(transport.getBalance()).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'getBalance')
  })
})
