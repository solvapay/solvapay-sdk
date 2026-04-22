import { describe, it, expect, vi } from 'vitest'
import { fetchMcpBootstrap } from '../bootstrap'
import type { McpAppBootstrapLike } from '../bootstrap'

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
  it('routes to upgrade by default and returns the bootstrap payload', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        stripePublishableKey: 'pk_test_abc',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'upgrade',
      arguments: {},
    })
    expect(result).toEqual({
      view: 'checkout',
      productRef: 'prod_123',
      stripePublishableKey: 'pk_test_abc',
      returnUrl: 'https://example.test/return',
      merchant: {},
      product: { reference: 'prod_123' },
      plans: [],
      customer: null,
    })
  })

  it('infers view from host toolInfo.tool.name', async () => {
    const app = mockApp({
      toolName: 'topup',
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'topup',
      arguments: {},
    })
    expect(result.view).toBe('topup')
    expect(result.stripePublishableKey).toBeNull()
  })

  it('falls back to checkout when the host invoked activate_plan (the picker now lives in checkout)', async () => {
    const app = mockApp({
      toolName: 'activate_plan',
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)
    expect(result.view).toBe('checkout')
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

  it('forwards enriched merchant/product/plans/customer from structuredContent', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        stripePublishableKey: 'pk_test_abc',
        returnUrl: 'https://example.test/return',
        merchant: { displayName: 'Acme', legalName: 'Acme Inc' },
        product: { reference: 'prod_123', name: 'Widget' },
        plans: [{ reference: 'pln_basic' }],
        customer: {
          ref: 'cus_42',
          purchase: { customerRef: 'cus_42', purchases: [] },
          paymentMethod: { kind: 'none' },
          balance: null,
          usage: null,
        },
      },
    })
    const result = await fetchMcpBootstrap(app)
    expect(result.merchant).toMatchObject({ displayName: 'Acme' })
    expect(result.product).toMatchObject({ name: 'Widget' })
    expect(result.plans).toHaveLength(1)
    expect(result.customer?.ref).toBe('cus_42')
  })

  it('propagates tool errors with the server text message', async () => {
    const app = mockApp({
      isError: true,
      text: 'customer_ref missing',
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow('customer_ref missing')
  })
})

