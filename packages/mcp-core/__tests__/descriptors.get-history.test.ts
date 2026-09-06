import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay, type SolvaPayClient } from '@solvapay/server'
import { buildSolvaPayDescriptors, MCP_TOOL_NAMES } from '../src'

function makeSolvaPay(client: Partial<SolvaPayClient> = {}) {
  return createSolvaPay({
    apiClient: {
      checkLimits: vi.fn().mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
      trackUsage: vi.fn().mockResolvedValue(undefined),
      createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_42' }),
      getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_42' }),
      getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
      getMerchant: vi.fn().mockResolvedValue({ displayName: 'Acme', legalName: 'Acme Inc' }),
      getProduct: vi.fn().mockResolvedValue({ reference: 'prd_test', name: 'Test product' }),
      listPlans: vi.fn().mockResolvedValue([{ reference: 'pln_basic', name: 'Basic' }]),
      ...client,
    } as unknown as SolvaPayClient,
  })
}

function buildTools(client: Partial<SolvaPayClient> = {}) {
  return buildSolvaPayDescriptors({
    solvaPay: makeSolvaPay(client),
    productRef: 'prd_test',
    resourceUri: 'ui://test/view.html',
    readHtml: async () => '<html></html>',
    publicBaseUrl: 'https://example.com',
  }).tools
}

const historyAuth = { authInfo: { extra: { customer_ref: 'cus_42' } } }

describe('get_history descriptor', () => {
  it('is a UI-only read tool, not an intent tool', () => {
    const tool = buildTools().find(t => t.name === MCP_TOOL_NAMES.getHistory)
    expect(tool).toBeTruthy()
    expect(tool!.description).toMatch(/UI-only/i)
    expect((tool!.meta as Record<string, unknown>).audience).toBe('ui')
    expect((tool!.meta as { ui?: { visibility?: readonly string[] } }).ui?.visibility).toEqual([
      'app',
    ])
    expect((tool!.meta as Record<string, unknown>)['openai/widgetAccessible']).toBe(true)
    expect((tool!.meta as Record<string, unknown>)['openai/visibility']).toBe('private')
    expect(tool!.annotations).toMatchObject({
      openWorldHint: true,
      readOnlyHint: true,
      idempotentHint: true,
    })
  })

  it('returns charges and creditActivity for the authenticated customer', async () => {
    const charges = [
      {
        reference: 'pur_1',
        customerRef: 'cus_42',
        productRef: 'prd_test',
        status: 'active',
        startDate: '2026-09-01T00:00:00.000Z',
        amount: 3000,
        currency: 'USD',
        isRecurring: true,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    const creditActivity = {
      entries: [
        {
          type: 'USAGE' as const,
          amount: -200,
          balance: 599800,
          productName: 'Cool MCP',
          productRef: 'prd_test',
          timestamp: '2026-09-05T14:22:00.000Z',
        },
      ],
      hasMore: false,
    }
    const listPurchases = vi.fn().mockResolvedValue({ purchases: charges })
    const getCreditActivity = vi.fn().mockResolvedValue(creditActivity)
    const tool = buildTools({ listPurchases, getCreditActivity }).find(
      t => t.name === MCP_TOOL_NAMES.getHistory,
    )
    if (!tool) throw new Error('get_history not registered')

    const result = await tool.handler({ limit: 25 }, historyAuth)

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual({ charges, creditActivity })
    expect(listPurchases).toHaveBeenCalledWith({
      customerRef: 'cus_42',
      productRef: 'prd_test',
    })
    expect(getCreditActivity).toHaveBeenCalledWith({
      customerRef: 'cus_42',
      limit: 25,
    })
  })

  it('uses an explicit productRef argument over the server default', async () => {
    const listPurchases = vi.fn().mockResolvedValue({ purchases: [] })
    const getCreditActivity = vi.fn().mockResolvedValue({ entries: [], hasMore: false })
    const tool = buildTools({ listPurchases, getCreditActivity }).find(
      t => t.name === MCP_TOOL_NAMES.getHistory,
    )
    if (!tool) throw new Error('get_history not registered')

    await tool.handler({ productRef: 'prd_other' }, historyAuth)

    expect(listPurchases).toHaveBeenCalledWith({
      customerRef: 'cus_42',
      productRef: 'prd_other',
    })
  })

  it('returns 401 when customer_ref is missing', async () => {
    const tool = buildTools().find(t => t.name === MCP_TOOL_NAMES.getHistory)
    if (!tool) throw new Error('get_history not registered')

    const result = await tool.handler({}, {})
    expect(result.isError).toBe(true)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe(401)
  })
})
