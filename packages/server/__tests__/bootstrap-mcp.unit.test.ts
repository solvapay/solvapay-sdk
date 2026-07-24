import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay } from '../src'
import type {
  ConfigureMcpPlansRequest,
  McpBootstrapRequest,
  ToolPlanMappingInput,
} from '../src/types/client'

/**
 * The MCP bootstrap / configure-plans HTTP wire (endpoint, body, error mapping)
 * is Rust-only (napi / WASM) and covered by `client-native-dispatch.unit.test.ts`,
 * the Group C dispatch suite, and the `client/bootstrap-mcp-product` /
 * `client/configure-mcp-plans` contract fixtures. This suite covers the
 * `createSolvaPay` facade delegation and the public request-type surface.
 */
describe('MCP bootstrap SDK facade', () => {
  it('exposes bootstrap helper on createSolvaPay with delegated apiClient call', async () => {
    const bootstrapMcpProduct = vi.fn().mockResolvedValue({
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
        bootstrapMcpProduct,
      },
    })

    const request: McpBootstrapRequest = {
      name: 'Docs Assistant',
      originUrl: 'https://origin.example.com/mcp',
      plans: [
        { key: 'free', name: 'Free', price: 0, currency: 'USD', type: 'recurring', freeUnits: 1000 },
        { key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' },
      ],
    }

    await sdk.bootstrapMcpProduct(request)
    expect(bootstrapMcpProduct).toHaveBeenCalledWith(request)
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
      },
    })

    const request: ConfigureMcpPlansRequest = {
      plans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' }],
      toolMapping: [{ name: 'read_wiki_contents', planKeys: ['pro'] }],
    }

    await sdk.configureMcpPlans('prd_TEST123', request)
    expect(configureMcpPlans).toHaveBeenCalledWith('prd_TEST123', request)
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
      plans: [
        { key: 'free', name: 'Starter', price: 0, currency: 'USD', type: 'recurring', freeUnits: 500 },
        { key: 'pro', name: 'Pro', price: 2000, currency: 'USD' },
      ],
      tools: [tool],
      metadata: { stage: 'test' },
    }

    expect(request.tools?.[0].name).toBe('list_docs')
    expect(request.name).toBeUndefined()
    expect(request.plans?.[0].name).toBe('Starter')
    expect(request.plans?.[1].currency).toBe('USD')
  })

  it('keeps configure MCP plans request types compile-safe', () => {
    const request: ConfigureMcpPlansRequest = {
      plans: [{ key: 'pro', name: 'Pro', price: 2000, currency: 'USD' }],
      toolMapping: [{ name: 'list_docs', planKeys: ['free', 'pro'] }],
    }

    expect(request.plans?.[0].key).toBe('pro')
    expect(request.toolMapping?.[0].planKeys).toEqual(['free', 'pro'])
  })
})
