import { describe, it, expect, vi } from 'vitest'
import { createMcpAppAdapter } from '../adapter'
import { TransportError } from '../../transport/errors'
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
      name: MCP_TOOL_NAMES.createHostedSession,
      arguments: { kind: 'checkout', productRef: 'prd_api' },
    })
  })

  it('routes createCustomerSession with empty arguments', async () => {
    const app = createMockApp(() => ({
      structuredContent: { customerUrl: 'https://portal.solvapay/test' },
    }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.createCustomerSession?.()

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: MCP_TOOL_NAMES.createHostedSession,
      arguments: { kind: 'portal' },
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
      'attachBusinessDetails',
      'createCaptureGrant',
      'confirmPayment',
      'createCardSetupGrant',
      'saveCard',
      'cancelRenewal',
      'reactivateRenewal',
      'activatePlan',
      'createCheckoutSession',
      'createCustomerSession',
      'getHistory',
    ] as const

    for (const key of keys) {
      expect(typeof transport[key]).toBe('function')
    }
  })

  it('routes createCaptureGrant to create_capture_grant with only the payment id and returns the grant', async () => {
    const grant = {
      token: 'vgs-collect-token',
      tenantId: 'tntr4ol0cbq',
      environment: 'sandbox',
      expiresAt: 1_800_000_000_000,
      scope: { paymentIntentId: 'pi_1' },
    }
    const app = createMockApp(() => ({ structuredContent: grant }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.createCaptureGrant?.({ paymentIntentId: 'pi_1' })

    expect(app.callServerTool).toHaveBeenCalledTimes(1)
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'create_capture_grant',
      arguments: { paymentIntentId: 'pi_1' },
    })
    expect(MCP_TOOL_NAMES.createCaptureGrant).toBe('create_capture_grant')
    expect(result).toStrictEqual(grant)
  })

  it('routes createCardSetupGrant to create_card_setup_grant with no arguments and returns the session grant', async () => {
    const grant = {
      token: 'vgs-collect-token',
      tenantId: 'tntr4ol0cbq',
      environment: 'sandbox',
      expiresAt: 1_800_000_000_000,
      scope: { sessionId: 'cs_sess_1' },
    }
    const app = createMockApp(() => ({ structuredContent: grant }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.createCardSetupGrant?.()

    expect(app.callServerTool).toHaveBeenCalledTimes(1)
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'create_card_setup_grant',
      arguments: {},
    })
    expect(MCP_TOOL_NAMES.createCardSetupGrant).toBe('create_card_setup_grant')
    expect(result).toStrictEqual(grant)
  })

  it('routes saveCard to save_card with the session, card id and return URL', async () => {
    const saved = { status: 'requires_action', redirectUrl: 'https://acs.bank.test/3ds/setup' }
    const app = createMockApp(() => ({ structuredContent: saved }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.saveCard?.({
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/r',
    })

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'save_card',
      arguments: { sessionId: 'cs_sess_1', cardId: 'CRD1', returnUrl: 'https://app.example/r' },
    })
    expect(MCP_TOOL_NAMES.saveCard).toBe('save_card')
    expect(result).toStrictEqual(saved)
  })

  it('routes the completion of a pending setup to save_card as { sessionId, completePendingSetup: true }', async () => {
    const saved = { status: 'succeeded', paymentMethod: { id: 'spm_1' } }
    const app = createMockApp(() => ({ structuredContent: saved }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.saveCard?.({
      sessionId: 'cs_sess_1',
      completePendingSetup: true,
    })

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'save_card',
      arguments: { sessionId: 'cs_sess_1', completePendingSetup: true },
    })
    expect(result).toStrictEqual(saved)
  })

  it('routes removePaymentMethod to remove_payment_method with no arguments', async () => {
    const removed = {
      removed: { brand: 'visa', last4: '0018', expMonth: 12, expYear: 2030 },
      autoRechargePaused: false,
    }
    const app = createMockApp(() => ({ structuredContent: removed }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.removePaymentMethod?.()

    expect(app.callServerTool).toHaveBeenCalledTimes(1)
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'remove_payment_method',
      arguments: {},
    })
    expect(MCP_TOOL_NAMES.removePaymentMethod).toBe('remove_payment_method')
    expect(result).toStrictEqual(removed)
  })

  it('routes confirmPayment to confirm_payment with the card id, dropping an undefined returnUrl', async () => {
    const payment = { id: 'pi_1', processorPaymentId: 'pi_rail_1', status: 'succeeded' }
    const app = createMockApp(() => ({ structuredContent: payment }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.confirmPayment?.({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: undefined,
    })

    expect(app.callServerTool).toHaveBeenCalledTimes(1)
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'confirm_payment',
      arguments: { paymentIntentId: 'pi_1', cardId: 'CRD1' },
    })
    expect(Object.keys(app.calls[0].args)).toStrictEqual(['paymentIntentId', 'cardId'])
    expect(MCP_TOOL_NAMES.confirmPayment).toBe('confirm_payment')
    expect(result).toStrictEqual(payment)
  })

  it('routes confirmPayment with a saved payment method and forwards returnUrl when given', async () => {
    const payment = {
      id: 'pi_1',
      processorPaymentId: 'pi_rail_1',
      status: 'requires_action',
      redirectUrl: 'https://acs.bank.test/3ds/abc',
    }
    const app = createMockApp(() => ({ structuredContent: payment }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.confirmPayment?.({
      paymentIntentId: 'pi_1',
      paymentMethodId: 'pm_saved',
      returnUrl: 'https://app.example/return',
    })

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'confirm_payment',
      arguments: {
        paymentIntentId: 'pi_1',
        paymentMethodId: 'pm_saved',
        returnUrl: 'https://app.example/return',
      },
    })
    expect(result).toStrictEqual(payment)
  })

  it('rejects vault calls with the tool error text when the server marks the result isError', async () => {
    const app = createMockApp(record => ({
      isError: true,
      content: [{ type: 'text', text: `${record.name}: Capture grant limit reached` }],
    }))
    const transport = createMcpAppAdapter(app)

    await expect(transport.createCaptureGrant?.({ paymentIntentId: 'pi_1' })).rejects.toThrow(
      'create_capture_grant: Capture grant limit reached',
    )
    await expect(
      transport.confirmPayment?.({ paymentIntentId: 'pi_1', cardId: 'CRD1' }),
    ).rejects.toThrow('confirm_payment: Capture grant limit reached')
    expect(app.callServerTool).toHaveBeenCalledTimes(2)
  })

  it('rejects a keyed tool error as a TransportError with the key, status, reason and decline code', async () => {
    const declined = {
      error: 'Confirm payment failed (402): Payment card_declined',
      status: 402,
      details: 'Confirm payment failed (402): Payment card_declined',
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    }
    const app = createMockApp(() => ({
      isError: true,
      content: [{ type: 'text', text: declined.details }],
      structuredContent: declined,
    }))
    const transport = createMcpAppAdapter(app)

    const thrown = await transport.confirmPayment({ paymentIntentId: 'pi_1', cardId: 'CRD1' }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(thrown).toBeInstanceOf(TransportError)
    expect(thrown).toMatchObject({
      message: declined.details,
      status: 402,
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    })
  })

  it('routes confirmPayment with billingDetails to confirm_payment', async () => {
    const payment = { id: 'pi_1', processorPaymentId: 'pi_rail_1', status: 'succeeded' }
    const app = createMockApp(() => ({ structuredContent: payment }))
    const transport = createMcpAppAdapter(app)
    const billingDetails = { name: 'Ada', address: { country: 'SE' } }

    await transport.confirmPayment({
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://mcp.example/solvapay/payment-return',
      billingDetails,
    })

    expect(app.calls[0]).toStrictEqual({
      name: MCP_TOOL_NAMES.confirmPayment,
      args: {
        paymentIntentId: 'pi_1',
        cardId: 'CRD1',
        returnUrl: 'https://mcp.example/solvapay/payment-return',
        billingDetails,
      },
    })
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
    expect(transport.getLimits).toBeUndefined()
  })

  it('routes getHistory as the bootstrap-exception read tool', async () => {
    const app = createMockApp(() => ({
      structuredContent: { charges: [], creditActivity: { entries: [], hasMore: false } },
    }))
    const transport = createMcpAppAdapter(app)

    const result = await transport.getHistory?.({ productRef: 'prd_widget', limit: 20 })

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: MCP_TOOL_NAMES.getHistory,
      arguments: { productRef: 'prd_widget', limit: 20 },
    })
    expect(result).toEqual({ charges: [], creditActivity: { entries: [], hasMore: false } })
  })
})
