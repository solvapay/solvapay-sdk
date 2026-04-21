import { describe, it, expect, vi } from 'vitest'
import { createMcpAppAdapter } from '../adapter'
import { MCP_TOOL_NAMES } from '@solvapay/mcp'

interface CallRecord {
  name: string
  args: Record<string, unknown>
}

function createMockApp(
  handler: (record: CallRecord) => {
    isError?: boolean
    structuredContent?: unknown
    content?: Array<{ type: string; text?: string }>
  },
) {
  const calls: CallRecord[] = []
  return {
    calls,
    callServerTool: vi.fn(
      async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => {
        const record: CallRecord = { name, args: args ?? {} }
        calls.push(record)
        return handler(record)
      },
    ),
  }
}

describe('createMcpAppAdapter', () => {
  it('routes checkPurchase through app.callServerTool with the check_purchase tool name', async () => {
    const purchaseData = {
      customerRef: 'cus_abc',
      purchases: [
        {
          reference: 'pur_1',
          productName: 'Pro',
          status: 'active',
          startDate: '2026-01-01',
        },
      ],
    }
    const app = createMockApp(() => ({ structuredContent: purchaseData }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.checkPurchase?.()

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: MCP_TOOL_NAMES.checkPurchase,
      arguments: {},
    })
    expect(result).toEqual(purchaseData)
  })

  it('routes createCheckoutSession with only the provided arguments (omits undefined fields)', async () => {
    const app = createMockApp(() => ({
      structuredContent: { checkoutUrl: 'https://pay.solvapay/test' },
    }))
    const transport = createMcpAppAdapter(app)

    await transport.createCheckoutSession?.({ productRef: 'prd_api' })

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: MCP_TOOL_NAMES.createCheckoutSession,
      arguments: { productRef: 'prd_api' },
    })
  })

  it('routes createCustomerSession with empty arguments', async () => {
    const app = createMockApp(() => ({
      structuredContent: { customerUrl: 'https://portal.solvapay/test' },
    }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.createCustomerSession?.()

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: MCP_TOOL_NAMES.createCustomerSession,
      arguments: {},
    })
    expect(result).toEqual({ customerUrl: 'https://portal.solvapay/test' })
  })

  it('falls back to content[0].text JSON when structuredContent is missing', async () => {
    const app = createMockApp(() => ({
      content: [{ type: 'text', text: JSON.stringify({ checkoutUrl: 'https://fallback.test' }) }],
    }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.createCheckoutSession?.()

    expect(result).toEqual({ checkoutUrl: 'https://fallback.test' })
  })

  it('throws when the MCP tool result is marked isError with the text payload as message', async () => {
    const app = createMockApp(() => ({
      isError: true,
      content: [{ type: 'text', text: 'customer_ref missing' }],
    }))
    const transport = createMcpAppAdapter(app)

    await expect(transport.checkPurchase?.()).rejects.toThrow('customer_ref missing')
  })

  it('throws when the MCP tool returns no parseable content', async () => {
    const app = createMockApp(() => ({ content: [] }))
    const transport = createMcpAppAdapter(app)

    await expect(transport.checkPurchase?.()).rejects.toThrow(/no parseable content/i)
  })

  it('covers the full transport surface (every MCP_TOOL_NAMES key has a matching transport method)', async () => {
    const app = createMockApp(record => ({
      structuredContent: { ok: true, tool: record.name },
    }))
    const transport = createMcpAppAdapter(app)

    // Narrowed to transport-surface keys only — the rest of
    // `MCP_TOOL_NAMES` covers bootstrap / sync tools that don't have a
    // matching transport method by design.
    const keys = [
      'checkPurchase',
      'createPayment',
      'processPayment',
      'createTopupPayment',
      'getBalance',
      'cancelRenewal',
      'reactivateRenewal',
      'activatePlan',
      'createCheckoutSession',
      'createCustomerSession',
      'getMerchant',
      'getProduct',
      'listPlans',
      'getPaymentMethod',
      'getUsage',
    ] as const

    for (const key of keys) {
      expect(typeof transport[key]).toBe('function')
    }
  })

  it('routes getPaymentMethod through the get_payment_method tool', async () => {
    const app = createMockApp(() => ({
      structuredContent: { kind: 'card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
    }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.getPaymentMethod?.()

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: MCP_TOOL_NAMES.getPaymentMethod,
      arguments: {},
    })
    expect(result).toEqual({
      kind: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    })
  })

  it('forwards a single-string argument (listPlans, getProduct) under its documented key', async () => {
    const app = createMockApp(record => ({
      structuredContent:
        record.name === MCP_TOOL_NAMES.listPlans ? { plans: [], productRef: 'prd_api' } : {},
    }))
    const transport = createMcpAppAdapter(app)

    await transport.listPlans?.('prd_api')
    await transport.getProduct?.('prd_api')

    expect(app.calls).toContainEqual({
      name: MCP_TOOL_NAMES.listPlans,
      args: { productRef: 'prd_api' },
    })
    expect(app.calls).toContainEqual({
      name: MCP_TOOL_NAMES.getProduct,
      args: { productRef: 'prd_api' },
    })
  })

  it('unwraps listPlans structured content to a Plan[] matching the declared return type', async () => {
    const plans = [
      { reference: 'pln_free', name: 'Free', isActive: true },
      { reference: 'pln_pro', name: 'Pro', isActive: true, default: true },
    ]
    const app = createMockApp(() => ({
      structuredContent: { plans, productRef: 'prd_api' },
    }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.listPlans?.('prd_api')

    expect(result).toEqual(plans)
  })
})
