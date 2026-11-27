import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src'
import type { ConfigureMcpPlansRequest, ConfigureMcpPlansResponse } from '../src/types/client'

describe('configure MCP plans SDK wrapper', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('calls configure MCP plans endpoint and returns typed response payload', async () => {
    const payload: ConfigureMcpPlansResponse = {
      product: {
        id: 'prd_1',
        reference: 'prd_TEST123',
        name: 'Docs Assistant',
        status: 'active',
        balance: 0,
        totalTransactions: 0,
        isManagedMcp: true,
        isMcpPay: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      mcpServer: {
        id: 'mcp_1',
        reference: 'mcp_TEST123',
        subdomain: 'docs-assistant',
        mcpProxyUrl: 'https://docs-assistant.mcp.solvapay.com/mcp',
        url: 'https://origin.example.com/mcp',
        defaultPlanId: 'plan_free_1',
      },
      planMap: {
        free: { id: 'plan_free_1', reference: 'pln_FREE123', name: 'Free' },
        pro: { id: 'plan_pro_1', reference: 'pln_PRO123', name: 'Pro' },
      },
    }

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sk_sandbox_test',
      apiBaseUrl: 'https://api.example.com',
    })

    const result = await client.configureMcpPlans?.('prd_TEST123', {
      plans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' }],
      toolMapping: [{ name: 'deep_research', planKeys: ['pro'] }],
    })

    expect(result).toEqual(payload)
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/sdk/products/prd_TEST123/mcp/plans',
      expect.objectContaining({
        method: 'PUT',
      }),
    )
  })

  it('throws SolvaPayError with status/body details on configure MCP plans failure', async () => {
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            code: 'UNKNOWN_PLAN_KEY',
            message: 'tool "search_docs" references unknown plan key "enterprise"',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    )

    const client = createSolvaPayClient({
      apiKey: 'sk_sandbox_test',
      apiBaseUrl: 'https://api.example.com',
    })

    try {
      await client.configureMcpPlans?.('prd_TEST123', {
        toolMapping: [{ name: 'search_docs', planKeys: ['enterprise'] }],
      })
      throw new Error('Expected configureMcpPlans to throw')
    } catch (error) {
      expect((error as Error).name).toBe('SolvaPayError')
      expect((error as Error).message).toContain('Configure MCP plans failed (400)')
      expect((error as Error).message).toContain('UNKNOWN_PLAN_KEY')
    }
  })

  it('exposes configure MCP plans helper on createSolvaPay with delegated apiClient call', async () => {
    const configureMcpPlans = vi.fn().mockResolvedValue({
      product: { reference: 'prd_TEST123' },
      mcpServer: {
        mcpProxyUrl: 'https://docs-assistant.mcp.solvapay.com/mcp',
        url: 'https://origin.example.com/mcp',
      },
      planMap: {},
    })

    const sdk = createSolvaPay({
      apiClient: {
        checkLimits: vi.fn(),
        trackUsage: vi.fn(),
        configureMcpPlans,
      } as any,
    })

    const request: ConfigureMcpPlansRequest = {
      plans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' }],
      toolMapping: [{ name: 'read_wiki_contents', planKeys: ['pro'] }],
    }

    await sdk.configureMcpPlans('prd_TEST123', request)
    expect(configureMcpPlans).toHaveBeenCalledWith('prd_TEST123', request)
  })

  it('keeps configure MCP plans request types compile-safe', () => {
    const request: ConfigureMcpPlansRequest = {
      plans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD' }],
      toolMapping: [{ name: 'list_docs', planKeys: ['free', 'pro'] }],
    }

    expect(request.plans?.[0].key).toBe('pro')
    expect(request.toolMapping?.[0].planKeys).toEqual(['free', 'pro'])
  })

  it('configures MCP plans with mixed free + paid plans in unified array', async () => {
    const payload: ConfigureMcpPlansResponse = {
      product: {
        id: 'prd_1',
        reference: 'prd_MIXED',
        name: 'Mixed Plans Tool',
        status: 'active',
        balance: 0,
        totalTransactions: 0,
        isManagedMcp: true,
        isMcpPay: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      mcpServer: {
        id: 'mcp_1',
        reference: 'mcp_MIXED',
        subdomain: 'mixed-plans',
        mcpProxyUrl: 'https://mixed-plans.mcp.solvapay.com/mcp',
        url: 'https://origin.example.com/mcp',
        defaultPlanId: 'plan_free_mixed',
      },
      planMap: {
        free: { id: 'plan_free_mixed', reference: 'pln_FREE_M', name: 'Free' },
        pro: { id: 'plan_pro_mixed', reference: 'pln_PRO_M', name: 'Pro' },
      },
    }

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sk_sandbox_test',
      apiBaseUrl: 'https://api.example.com',
    })

    const result = await client.configureMcpPlans?.('prd_MIXED', {
      plans: [
        { key: 'free', name: 'Free', price: 0, currency: 'USD', type: 'recurring', freeUnits: 100 },
        { key: 'pro', name: 'Pro', price: 4900, currency: 'USD', billingCycle: 'monthly' },
      ],
      toolMapping: [
        { name: 'basic_search', planKeys: ['free', 'pro'] },
        { name: 'deep_research', planKeys: ['pro'] },
      ],
    })

    expect(result?.planMap.free).toBeDefined()
    expect(result?.planMap.pro).toBeDefined()

    const sentBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body)
    expect(sentBody.plans).toHaveLength(2)
    expect(sentBody.plans[0].price).toBe(0)
    expect(sentBody.plans[1].price).toBe(4900)
    expect(sentBody.toolMapping).toHaveLength(2)
  })
})
