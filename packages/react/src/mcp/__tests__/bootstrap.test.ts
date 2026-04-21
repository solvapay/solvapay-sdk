import { describe, it, expect, vi } from 'vitest'
import { fetchMcpBootstrap, createMcpFetch } from '../bootstrap'
import type { McpAppBootstrapLike } from '../bootstrap'
import type { SolvaPayTransport } from '../../transport/types'

function mockApp(opts: {
  toolName?: string
  structuredContent?: unknown
  isError?: boolean
  text?: string
}): McpAppBootstrapLike {
  return {
    callServerTool: vi.fn().mockResolvedValue({
      isError: opts.isError,
      structuredContent: opts.structuredContent,
      content: opts.text ? [{ type: 'text', text: opts.text }] : undefined,
    }),
    getHostContext: () =>
      opts.toolName ? { toolInfo: { tool: { name: opts.toolName } } } : undefined,
  }
}

describe('fetchMcpBootstrap', () => {
  it('routes to open_checkout by default and returns the bootstrap payload', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        stripePublishableKey: 'pk_test_abc',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'open_checkout',
      arguments: {},
    })
    expect(result).toEqual({
      view: 'checkout',
      productRef: 'prod_123',
      stripePublishableKey: 'pk_test_abc',
      returnUrl: 'https://example.test/return',
    })
  })

  it('infers view from host toolInfo.tool.name', async () => {
    const app = mockApp({
      toolName: 'open_topup',
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'open_topup',
      arguments: {},
    })
    expect(result.view).toBe('topup')
    expect(result.stripePublishableKey).toBeNull()
  })

  it('maps open_plan_activation to the activate view', async () => {
    const app = mockApp({
      toolName: 'open_plan_activation',
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)
    expect(result.view).toBe('activate')
  })

  it('throws when the tool response has no productRef', async () => {
    const app = mockApp({
      structuredContent: { returnUrl: 'https://example.test/return' },
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow(/productRef/)
  })

  it('throws when returnUrl is not an http(s) URL', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'ui://bad',
      },
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow(/valid http\(s\) returnUrl/)
  })

  it('propagates tool errors with the server text message', async () => {
    const app = mockApp({
      isError: true,
      text: 'customer_ref missing',
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow('customer_ref missing')
  })
})

function mockTransport(overrides: Partial<SolvaPayTransport> = {}): SolvaPayTransport {
  return {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('createMcpFetch', () => {
  it('routes /api/list-plans through transport.listPlans', async () => {
    const plans = [{ reference: 'plan_a' }]
    const transport = mockTransport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listPlans: vi.fn().mockResolvedValue(plans as any),
    })

    const fetchImpl = createMcpFetch(transport)
    const res = await fetchImpl('/api/list-plans?productRef=prod_123')
    const body = await res.json()

    expect(transport.listPlans).toHaveBeenCalledWith('prod_123')
    expect(res.status).toBe(200)
    expect(body).toEqual({ plans, productRef: 'prod_123' })
  })

  it('returns 400 when /api/list-plans is missing productRef', async () => {
    const transport = mockTransport()
    const res = await createMcpFetch(transport)('/api/list-plans')
    expect(res.status).toBe(400)
  })

  it('routes /api/get-product through transport.getProduct', async () => {
    const product = { reference: 'prod_123', name: 'Widget' }
    const transport = mockTransport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getProduct: vi.fn().mockResolvedValue(product as any),
    })
    const res = await createMcpFetch(transport)('/api/get-product?productRef=prod_123')
    expect(await res.json()).toEqual(product)
    expect(transport.getProduct).toHaveBeenCalledWith('prod_123')
  })

  it('routes /api/merchant through transport.getMerchant', async () => {
    const merchant = { defaultCurrency: 'USD' }
    const transport = mockTransport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getMerchant: vi.fn().mockResolvedValue(merchant as any),
    })
    const res = await createMcpFetch(transport)('/api/merchant')
    expect(await res.json()).toEqual(merchant)
  })

  it('returns 501 for unrouted paths', async () => {
    const transport = mockTransport()
    const res = await createMcpFetch(transport)('/api/unknown')
    expect(res.status).toBe(501)
  })

  it('returns 500 when the transport throws', async () => {
    const transport = mockTransport({
      getMerchant: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const res = await createMcpFetch(transport)('/api/merchant')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('boom')
  })
})
