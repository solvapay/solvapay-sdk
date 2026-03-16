import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src'
import type {
  McpBootstrapRequest,
  McpBootstrapResponse,
  ToolPlanMappingInput,
} from '../src/types/client'

describe('MCP bootstrap SDK wrapper', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('calls bootstrap endpoint and returns typed response payload', async () => {
    const payload: McpBootstrapResponse = {
      product: {
        id: 'prd_1',
        reference: 'prd_TEST123',
        name: 'Docs Assistant',
        status: 'active',
        balance: 0,
        totalTransactions: 0,
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
      toolsAutoMapped: true,
      autoMappedTools: [{ name: 'list_docs', description: 'List docs' }],
    }

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sk_sandbox_test',
      apiBaseUrl: 'https://api.example.com',
    })

    const result = await client.bootstrapMcpProduct?.({
      name: 'Docs Assistant',
      originUrl: 'https://origin.example.com/mcp',
      freePlan: { freeUnits: 1000 },
      paidPlans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' }],
      tools: [{ name: 'list_docs', planKeys: ['free'] }],
    })

    expect(result).toEqual(payload)
    expect(result?.toolsAutoMapped).toBe(true)
    expect(result?.autoMappedTools?.[0]?.name).toBe('list_docs')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/sdk/products/mcp/bootstrap',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('throws SolvaPayError with status/body details on bootstrap failure', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
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
      await client.bootstrapMcpProduct?.({
        name: 'Docs Assistant',
        originUrl: 'https://origin.example.com/mcp',
        paidPlans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' }],
        tools: [{ name: 'search_docs', planKeys: ['enterprise'] }],
      })
      throw new Error('Expected bootstrapMcpProduct to throw')
    } catch (error) {
      expect((error as Error).name).toBe('SolvaPayError')
      expect((error as Error).message).toContain('Bootstrap MCP product failed (400)')
      expect((error as Error).message).toContain('UNKNOWN_PLAN_KEY')
    }
  })

  it('exposes bootstrap helper on createSolvaPay with delegated apiClient call', async () => {
    const bootstrapMcpProduct = vi.fn().mockResolvedValue({
      product: { reference: 'prd_TEST123' },
      mcpServer: { mcpProxyUrl: 'https://docs-assistant.mcp.solvapay.com/mcp', url: 'https://origin.example.com/mcp' },
      planMap: {},
    })

    const sdk = createSolvaPay({
      apiClient: {
        checkLimits: vi.fn(),
        trackUsage: vi.fn(),
        bootstrapMcpProduct,
      } as any,
    })

    const request: McpBootstrapRequest = {
      name: 'Docs Assistant',
      originUrl: 'https://origin.example.com/mcp',
      freePlan: { freeUnits: 1000 },
      paidPlans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' }],
    }

    await sdk.bootstrapMcpProduct(request)
    expect(bootstrapMcpProduct).toHaveBeenCalledWith(request)
  })

  it('supports bootstrap request without explicit name when backend derives metadata', async () => {
    const payload: McpBootstrapResponse = {
      product: {
        id: 'prd_2',
        reference: 'prd_TEST456',
        name: 'origin-example-com',
        status: 'active',
        balance: 0,
        totalTransactions: 0,
        isMcpPay: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      mcpServer: {
        id: 'mcp_2',
        reference: 'mcp_TEST456',
        url: 'https://origin.example.com/mcp',
        defaultPlanId: 'plan_free_2',
      },
      planMap: {
        free: { id: 'plan_free_2', reference: 'pln_FREE456', name: 'Free' },
      },
    }

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sk_sandbox_test',
      apiBaseUrl: 'https://api.example.com',
    })

    const result = await client.bootstrapMcpProduct?.({
      originUrl: 'https://origin.example.com/mcp',
      tools: [{ name: 'health_check', noPlan: true }],
    })

    expect(result?.planMap.free).toBeDefined()
    expect(result?.planMap.pro).toBeUndefined()
    expect(result).not.toHaveProperty('appliedDefaults')
  })

  it('keeps bootstrap request and tool mapping types compile-safe', () => {
    const tool: ToolPlanMappingInput = {
      name: 'list_docs',
      planKeys: ['free'],
      planRefs: ['pln_FREE123'],
      planIds: ['plan_free_1'],
    }

    const request: McpBootstrapRequest = {
      originUrl: 'https://origin.example.com/mcp',
      freePlan: { name: 'Starter', freeUnits: 500 },
      paidPlans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD' }],
      tools: [tool],
      metadata: { stage: 'test' },
    }

    expect(request.tools?.[0].name).toBe('list_docs')
    expect(request.name).toBeUndefined()
    expect(request.freePlan?.name).toBe('Starter')
    expect(request.paidPlans?.[0].currency).toBe('USD')
  })
})
