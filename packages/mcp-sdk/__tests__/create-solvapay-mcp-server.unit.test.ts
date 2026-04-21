import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MCP_TOOL_NAMES } from '@solvapay/mcp'
import { createSolvaPay } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import { createSolvaPayMcpServer } from '../src'

// Stub the filesystem read for the UI resource so the helper can be tested
// without a real HTML bundle on disk.
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('<html></html>'),
  },
}))

function makeSolvaPay() {
  const client = {
    checkLimits: vi.fn().mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_new' }),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_existing' }),
    createCheckoutSession: vi
      .fn()
      .mockResolvedValue({ sessionId: 'sess_1', checkoutUrl: 'https://example.com/sess_1' }),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
  } as unknown as SolvaPayClient
  return createSolvaPay({ apiClient: client })
}

/**
 * Capture everything `createSolvaPayMcpServer` registers on the MCP
 * server. We only need `registerTool` / `registerResource` to be callable
 * — the `@modelcontextprotocol/ext-apps` helpers normalise the options
 * before delegating to these methods.
 */
function buildTestServer(overrides: Partial<Parameters<typeof createSolvaPayMcpServer>[0]> = {}) {
  const solvaPay = makeSolvaPay()
  const server = createSolvaPayMcpServer({
    solvaPay,
    productRef: 'prd_test',
    resourceUri: 'ui://test/view.html',
    htmlPath: '/tmp/fake/view.html',
    publicBaseUrl: 'https://example.com',
    ...overrides,
  })
  return { server, solvaPay }
}

describe('createSolvaPayMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-http public base URLs', () => {
    const solvaPay = makeSolvaPay()
    expect(() =>
      createSolvaPayMcpServer({
        solvaPay,
        productRef: 'prd_test',
        resourceUri: 'ui://test/view.html',
        htmlPath: '/tmp/fake/view.html',
        publicBaseUrl: 'ui://nope',
      }),
    ).toThrow(/http\(s\)/)
  })

  it('registers the full transport surface', () => {
    const { server } = buildTestServer()
    // The MCP SDK exposes registered tools via an internal collection; use
    // the listTools method available on McpServer.
    // @ts-expect-error — accessing private _registeredTools for test coverage
    const toolNames = Object.keys(server._registeredTools ?? {})
    const expected = [
      MCP_TOOL_NAMES.checkPurchase,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.getBalance,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.getMerchant,
      MCP_TOOL_NAMES.getProduct,
      MCP_TOOL_NAMES.listPlans,
      MCP_TOOL_NAMES.getPaymentMethod,
      MCP_TOOL_NAMES.getUsage,
      MCP_TOOL_NAMES.syncCustomer,
      MCP_TOOL_NAMES.openCheckout,
      MCP_TOOL_NAMES.openAccount,
      MCP_TOOL_NAMES.openTopup,
      MCP_TOOL_NAMES.openPlanActivation,
      MCP_TOOL_NAMES.openPaywall,
      MCP_TOOL_NAMES.openUsage,
    ]
    for (const name of expected) {
      expect(toolNames).toContain(name)
    }
  })

  it('gates open_* tools on the views option', () => {
    const { server } = buildTestServer({ views: ['checkout'] })
    // @ts-expect-error — accessing private _registeredTools for test coverage
    const toolNames = Object.keys(server._registeredTools ?? {})
    expect(toolNames).toContain(MCP_TOOL_NAMES.openCheckout)
    expect(toolNames).not.toContain(MCP_TOOL_NAMES.openAccount)
    expect(toolNames).not.toContain(MCP_TOOL_NAMES.openPaywall)
    expect(toolNames).not.toContain(MCP_TOOL_NAMES.openUsage)
  })

  it('invokes the additionalTools hook with a bound registerPayable', () => {
    const additional = vi.fn()
    buildTestServer({ additionalTools: additional })
    expect(additional).toHaveBeenCalledOnce()
    const ctx = additional.mock.calls[0][0]
    expect(ctx.productRef).toBe('prd_test')
    expect(ctx.resourceUri).toBe('ui://test/view.html')
    expect(typeof ctx.registerPayable).toBe('function')
  })
})
