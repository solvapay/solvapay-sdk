import { describe, expect, it, vi, beforeEach } from 'vitest'
import { z } from 'zod'
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
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
    ]
    for (const name of expected) {
      expect(toolNames).toContain(name)
    }
    // `check_usage` was removed when credits + usage folded into the
    // account view.
    expect(toolNames).not.toContain('check_usage')
  })

  it('gates intent tools on the views option', () => {
    const { server } = buildTestServer({ views: ['checkout'] })
    // @ts-expect-error — accessing private _registeredTools for test coverage
    const toolNames = Object.keys(server._registeredTools ?? {})
    expect(toolNames).toContain(MCP_TOOL_NAMES.upgrade)
    expect(toolNames).not.toContain(MCP_TOOL_NAMES.manageAccount)
    expect(toolNames).not.toContain('open_paywall')
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

  it('registers the slash-command prompts by default', () => {
    const { server } = buildTestServer()
    // @ts-expect-error — private registry used for coverage only
    const promptNames = Object.keys(server._registeredPrompts ?? {})
    expect(promptNames.sort()).toEqual(
      [
        MCP_TOOL_NAMES.activatePlan,
        MCP_TOOL_NAMES.manageAccount,
        MCP_TOOL_NAMES.topup,
        MCP_TOOL_NAMES.upgrade,
      ].sort(),
    )
  })

  it('opts out of prompts when registerPrompts: false', () => {
    const { server } = buildTestServer({ registerPrompts: false })
    // @ts-expect-error — private registry used for coverage only
    const promptNames = Object.keys(server._registeredPrompts ?? {})
    expect(promptNames).toEqual([])
  })

  it('only registers prompts for enabled views', () => {
    const { server } = buildTestServer({ views: ['checkout', 'account'] })
    // @ts-expect-error — private registry used for coverage only
    const promptNames = Object.keys(server._registeredPrompts ?? {})
    // `/activate_plan` is wired to the checkout view (it opens the
    // embedded plan picker when called without a planRef).
    expect(promptNames.sort()).toEqual(
      [
        MCP_TOOL_NAMES.activatePlan,
        MCP_TOOL_NAMES.manageAccount,
        MCP_TOOL_NAMES.upgrade,
      ].sort(),
    )
  })

  it('registers the docs overview resource by default', () => {
    const { server } = buildTestServer()
    // @ts-expect-error — private registry used for coverage only
    const resourceUris = Object.keys(server._registeredResources ?? {})
    expect(resourceUris).toContain('docs://solvapay/overview.md')
  })

  it('opts out of the docs resource when registerDocsResources: false', () => {
    const { server } = buildTestServer({ registerDocsResources: false })
    // @ts-expect-error — private registry used for coverage only
    const resourceUris = Object.keys(server._registeredResources ?? {})
    expect(resourceUris).not.toContain('docs://solvapay/overview.md')
  })

  it('mentions sibling intent tools in the upgrade description', () => {
    const { server } = buildTestServer()
    // @ts-expect-error — private registry used for coverage only
    const registered = server._registeredTools ?? {}
    const upgrade = registered[MCP_TOOL_NAMES.upgrade]
    expect(upgrade?.description).toContain('Also available')
    expect(upgrade?.description).toContain('manage_account')
    expect(upgrade?.description).toContain('activate_plan')
  })

  describe('tool annotations', () => {
    it('flows readOnly + idempotent annotations on manage_account', () => {
      const { server } = buildTestServer()
      // @ts-expect-error — private registry used for coverage only
      const registered = server._registeredTools ?? {}
      const manageAccount = registered[MCP_TOOL_NAMES.manageAccount]
      expect(manageAccount?.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('flows destructive annotations on upgrade', () => {
      const { server } = buildTestServer()
      // @ts-expect-error — private registry used for coverage only
      const registered = server._registeredTools ?? {}
      const upgrade = registered[MCP_TOOL_NAMES.upgrade]
      expect(upgrade?.annotations?.destructiveHint).toBe(true)
      expect(upgrade?.annotations?.openWorldHint).toBe(true)
    })

    it('registerPayable defaults to readOnly + openWorld for data tools', () => {
      const { server } = buildTestServer({
        additionalTools: ({ registerPayable }) => {
          registerPayable('search', {
            product: 'prd_x',
            schema: { q: z.string() },
            handler: async () => ({ ok: true }),
          })
        },
      })
      // @ts-expect-error — private registry used for coverage only
      const registered = server._registeredTools ?? {}
      const search = registered['search']
      expect(search?.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
      })
    })

    it('registerPayable respects explicit destructive override', () => {
      const { server } = buildTestServer({
        additionalTools: ({ registerPayable }) => {
          registerPayable('submit_order', {
            product: 'prd_x',
            schema: { id: z.string() },
            annotations: { readOnlyHint: false, destructiveHint: true },
            handler: async () => ({ ok: true }),
          })
        },
      })
      // @ts-expect-error — private registry used for coverage only
      const registered = server._registeredTools ?? {}
      const submit = registered['submit_order']
      expect(submit?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      })
    })
  })
})
