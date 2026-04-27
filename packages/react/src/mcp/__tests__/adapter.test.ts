import { describe, it, expect, vi } from 'vitest'
import { createMcpAppAdapter } from '../adapter'
import { MCP_TOOL_NAMES } from '@solvapay/mcp-core'

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

    await expect(transport.createCustomerSession?.()).rejects.toThrow('customer_ref missing')
  })

  it('covers the UI-transport surface (every state-change tool has a matching method)', async () => {
    const app = createMockApp(record => ({
      structuredContent: { ok: true, tool: record.name },
    }))
    const transport = createMcpAppAdapter(app)

    const keys = [
      'createPayment',
      'processPayment',
      'createTopupPayment',
      'cancelRenewal',
      'reactivateRenewal',
      'activatePlan',
      'createCheckoutSession',
      'createCustomerSession',
    ] as const

    for (const key of keys) {
      expect(typeof transport[key]).toBe('function')
    }
  })

  it('omits the read tools now folded into the bootstrap payload', () => {
    const app = createMockApp(() => ({ structuredContent: {} }))
    const transport = createMcpAppAdapter(app)

    // These used to be implemented by the adapter but now live on
    // `BootstrapPayload` and are seeded into the provider caches.
    expect(transport.checkPurchase).toBeUndefined()
    expect(transport.getBalance).toBeUndefined()
    expect(transport.getMerchant).toBeUndefined()
    expect(transport.getProduct).toBeUndefined()
    expect(transport.listPlans).toBeUndefined()
    expect(transport.getPaymentMethod).toBeUndefined()
    expect(transport.getUsage).toBeUndefined()
  })
})
