import { describe, expect, it, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { MCP_TOOL_NAMES } from '@solvapay/mcp-core'
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

async function invokeHandler(
  server: ReturnType<typeof createSolvaPayMcpServer>,
  method: string,
  params: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const handlers = (
    server as unknown as {
      server: { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>> }
    }
  ).server._requestHandlers
  const handler = handlers.get(method)
  if (!handler) throw new Error(`${method} handler not registered`)
  return handler(
    { method, params },
    {
      signal: new AbortController().signal,
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
      mcpReq: { requestState: () => undefined },
      ...extra,
    },
  )
}

async function listedTools(server: ReturnType<typeof createSolvaPayMcpServer>) {
  return (await invokeHandler(server, 'tools/list')) as {
    tools: Array<{
      name: string
      description?: string
      annotations?: unknown
      _meta?: Record<string, unknown> & {
        ui?: { resourceUri?: string; visibility?: unknown; icons?: Array<{ src: string }> }
      }
    }>
  }
}

async function listedToolNames(
  server: ReturnType<typeof createSolvaPayMcpServer>,
): Promise<string[]> {
  const listed = await listedTools(server)
  return listed.tools.map(t => t.name)
}

async function listedPrompts(server: ReturnType<typeof createSolvaPayMcpServer>) {
  return (await invokeHandler(server, 'prompts/list')) as { prompts: Array<{ name: string }> }
}

async function listedResources(server: ReturnType<typeof createSolvaPayMcpServer>) {
  return (await invokeHandler(server, 'resources/list')) as {
    resources: Array<{
      uri: string
      metadata?: { _meta?: { ui?: { prefersBorder?: boolean } } }
      _meta?: { ui?: { prefersBorder?: boolean } }
    }>
  }
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

  it('registers the full transport surface', async () => {
    const { server } = buildTestServer()
    const toolNames = await listedToolNames(server)
    const expected = [
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.attachBusinessDetails,
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

  it('registers attach_business_details so the checkout Payment step can compute tax (DEV-650)', async () => {
    const { server } = buildTestServer()
    const toolNames = await listedToolNames(server)
    expect(toolNames).toContain(MCP_TOOL_NAMES.attachBusinessDetails)
  })

  it('gates intent tools on the views option', async () => {
    const { server } = buildTestServer({ views: ['checkout'] })
    const toolNames = await listedToolNames(server)
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

  it('registers the slash-command prompts by default', async () => {
    const { server } = buildTestServer()
    const { prompts } = await listedPrompts(server)
    expect(prompts.map(p => p.name).sort()).toEqual(
      [
        MCP_TOOL_NAMES.activatePlan,
        MCP_TOOL_NAMES.manageAccount,
        MCP_TOOL_NAMES.topup,
        MCP_TOOL_NAMES.upgrade,
      ].sort(),
    )
  })

  it('opts out of prompts when registerPrompts: false', async () => {
    const { server } = buildTestServer({ registerPrompts: false })
    const { prompts } = await listedPrompts(server)
    expect(prompts).toEqual([])
  })

  it('only registers prompts for enabled views', async () => {
    const { server } = buildTestServer({ views: ['checkout', 'account'] })
    const { prompts } = await listedPrompts(server)
    expect(prompts.map(p => p.name).sort()).toEqual(
      [MCP_TOOL_NAMES.activatePlan, MCP_TOOL_NAMES.manageAccount, MCP_TOOL_NAMES.upgrade].sort(),
    )
  })

  it('registers the docs overview resource by default', async () => {
    const { server } = buildTestServer()
    const { resources } = await listedResources(server)
    expect(resources.map(r => r.uri)).toContain('docs://solvapay/overview.md')
  })

  it('registers the bootstrap resource by default', async () => {
    const { server } = buildTestServer()
    const { resources } = await listedResources(server)
    expect(resources.map(r => r.uri)).toContain('solvapay://bootstrap.json')
  })

  it('opts out of the docs resource when registerDocsResources: false', async () => {
    const { server } = buildTestServer({ registerDocsResources: false })
    const { resources } = await listedResources(server)
    expect(resources.map(r => r.uri)).not.toContain('docs://solvapay/overview.md')
  })

  it('forwards Authorization from the host request into generated mcpDispatch', async () => {
    const mcpDispatch = vi.fn().mockResolvedValue({
      kind: 'rpc',
      rpc: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: 'Opened your account.' }],
          _meta: { ui: { resourceUri: 'ui://solvapay/mcp-app.html' } },
          structuredContent: { view: 'account' },
        },
      },
    })
    const solvaPay = createSolvaPay({
      apiClient: {
        checkLimits: vi.fn(),
        trackUsage: vi.fn(),
        mcpDispatch,
      } as unknown as SolvaPayClient,
    })
    const server = createSolvaPayMcpServer({
      solvaPay,
      productRef: 'prd_test',
      resourceUri: 'ui://solvapay/mcp-app.html',
      htmlPath: '/tmp/fake/view.html',
      publicBaseUrl: 'https://example.com',
    })
    const result = (await invokeHandler(
      server,
      'tools/call',
      { name: MCP_TOOL_NAMES.manageAccount, arguments: {} },
      {
        request: new Request('https://example.com/mcp', {
          headers: { authorization: 'Bearer host-token' },
        }),
      },
    )) as { _meta?: { ui?: { resourceUri?: string } }; isError?: boolean }

    expect(mcpDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ authHeader: 'Bearer host-token' }),
    )
    expect(result.isError).not.toBe(true)
    expect(result._meta?.ui?.resourceUri).toBe('ui://solvapay/mcp-app.html')
  })

  it('mentions sibling intent tools in the upgrade description', async () => {
    const { server } = buildTestServer()
    const { tools } = await listedTools(server)
    const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)
    expect(upgrade?.description).toContain('Also available')
    expect(upgrade?.description).toContain('manage_account')
    expect(upgrade?.description).toContain('activate_plan')
  })

  describe('tool annotations', () => {
    it('flows readOnly + idempotent annotations on all intent tools', async () => {
      const { server } = buildTestServer()
      const { tools } = await listedTools(server)
      for (const name of [
        MCP_TOOL_NAMES.manageAccount,
        MCP_TOOL_NAMES.upgrade,
        MCP_TOOL_NAMES.topup,
      ]) {
        const tool = tools.find(t => t.name === name)
        expect(tool?.annotations).toEqual({
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
        })
      }
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

  describe('tool _meta.ui descriptor', () => {
    it('does NOT advertise _meta.ui.resourceUri on merchant payable tools (text-only paywall; widget reserved for intent tools)', async () => {
      const { server } = buildTestServer({
        additionalTools: ({ registerPayable }) => {
          registerPayable('search_knowledge', {
            title: 'Search (test)',
            schema: { query: z.string() },
            handler: async () => ({ ok: true }),
          })
        },
      })
      const { tools } = await listedTools(server)
      const payable = tools.find(t => t.name === 'search_knowledge')
      const ui = (payable?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
      expect(ui?.resourceUri).toBeUndefined()
      const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)
      const upgradeUi = (upgrade?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
      expect(upgradeUi?.resourceUri).toBe('ui://test/view.html')
    })

    it('stamps _meta.ui.visibility and openai/widgetAccessible on UI-only transport tools but not intent tools', async () => {
      const { server } = buildTestServer()
      const { tools } = await listedTools(server)
      const createPayment = tools.find(t => t.name === MCP_TOOL_NAMES.createPayment)
      const transportMeta = createPayment?._meta as
        | { ui?: { visibility?: readonly string[] } }
        | undefined
      expect(transportMeta?.ui?.visibility).toEqual(['app'])
      expect(
        (createPayment?._meta as Record<string, unknown> | undefined)?.['openai/widgetAccessible'],
      ).toBe(true)

      const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)
      const intentUi = (upgrade?._meta as { ui?: { visibility?: readonly string[] } } | undefined)
        ?.ui
      expect(intentUi?.visibility).not.toEqual(['app'])
      expect(
        (upgrade?._meta as Record<string, unknown> | undefined)?.['openai/widgetAccessible'],
      ).toBeUndefined()
    })

    it('stamps _meta.ui.icons on every intent tool when branding is provided', async () => {
      const { server } = buildTestServer({
        branding: {
          brandName: 'Acme',
          iconUrl: 'https://cdn.acme.test/icon.png',
          logoUrl: 'https://cdn.acme.test/logo.png',
        },
      })
      const { tools } = await listedTools(server)
      const manageAccount = tools.find(t => t.name === MCP_TOOL_NAMES.manageAccount)
      const ui = (manageAccount?._meta as { ui?: { icons?: Array<{ src: string }> } } | undefined)
        ?.ui
      expect(ui?.icons?.[0]?.src).toBe('https://cdn.acme.test/icon.png')
    })

    it('falls back to logoUrl when branding omits iconUrl', async () => {
      const { server } = buildTestServer({
        branding: {
          brandName: 'Acme',
          logoUrl: 'https://cdn.acme.test/logo.png',
        },
      })
      const { tools } = await listedTools(server)
      const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)
      const ui = (upgrade?._meta as { ui?: { icons?: Array<{ src: string }> } } | undefined)?.ui
      expect(ui?.icons?.[0]?.src).toBe('https://cdn.acme.test/logo.png')
    })

    it('uses branding.brandName as the MCP Implementation name', () => {
      const { server } = buildTestServer({
        branding: {
          brandName: 'Acme',
          iconUrl: 'https://cdn.acme.test/icon.png',
        },
      })
      // McpServer exposes the underlying Server via `.server`, which
      // stores the implementation info passed to its constructor.
      // Access via `_serverInfo` since there's no public getter.
      // @ts-expect-error — private state used for coverage only
      const info = server.server?._serverInfo ?? server.server?.['_serverInfo']
      expect(info?.name).toBe('Acme')
    })

    it('explicit serverName wins over branding.brandName', () => {
      const { server } = buildTestServer({
        serverName: 'acme-protocol-id',
        branding: { brandName: 'Acme' },
      })
      // @ts-expect-error — private state used for coverage only
      const info = server.server?._serverInfo ?? server.server?.['_serverInfo']
      expect(info?.name).toBe('acme-protocol-id')
    })

    it('stamps branding.iconUrl into Implementation.icons on initialize', () => {
      // MCP hosts (Claude Web / Desktop) paint the chrome strip from
      // `serverInfo.icons[0]` returned at `initialize` — stamping the
      // merchant icon there is what swaps the default globe for the
      // merchant mark. `sizes: ['any', '512x512']` mirrors the
      // `deriveIcons` projection for square `iconUrl` input.
      const { server } = buildTestServer({
        branding: {
          brandName: 'Acme',
          iconUrl: 'https://cdn.acme.test/icon.png',
          logoUrl: 'https://cdn.acme.test/logo.png',
        },
      })
      // @ts-expect-error — private state used for coverage only
      const info = server.server?._serverInfo ?? server.server?.['_serverInfo']
      expect(info?.icons?.[0]?.src).toBe('https://cdn.acme.test/icon.png')
      expect(info?.icons?.[0]?.sizes).toEqual(['any', '512x512'])
    })

    it('falls back to branding.logoUrl for Implementation.icons when iconUrl is missing', () => {
      const { server } = buildTestServer({
        branding: {
          brandName: 'Acme',
          logoUrl: 'https://cdn.acme.test/logo.png',
        },
      })
      // @ts-expect-error — private state used for coverage only
      const info = server.server?._serverInfo ?? server.server?.['_serverInfo']
      expect(info?.icons?.[0]?.src).toBe('https://cdn.acme.test/logo.png')
    })

    it('omits Implementation.icons when branding has no icon assets', () => {
      // Without either `iconUrl` or `logoUrl`, `deriveIcons` returns
      // `undefined` and we skip the field entirely so the handshake
      // matches the zero-branding baseline — no empty `icons: []` that
      // could fail stricter host validators.
      const { server } = buildTestServer({
        branding: { brandName: 'Acme' },
      })
      // @ts-expect-error — private state used for coverage only
      const info = server.server?._serverInfo ?? server.server?.['_serverInfo']
      expect(info?.icons).toBeUndefined()
    })

    it('omits Implementation.icons when no branding is passed at all', () => {
      const { server } = buildTestServer()
      // @ts-expect-error — private state used for coverage only
      const info = server.server?._serverInfo ?? server.server?.['_serverInfo']
      expect(info?.icons).toBeUndefined()
    })

    it('forwards icons into _meta.ui.icons on registerPayable', () => {
      const { server } = buildTestServer({
        additionalTools: ({ registerPayable }) => {
          registerPayable('search_branded', {
            title: 'Branded search',
            schema: { query: z.string() },
            icons: [{ src: 'https://cdn.acme.test/icon.png', sizes: ['512x512'] }],
            handler: async () => ({ ok: true }),
          })
        },
      })
      // @ts-expect-error — private registry used for coverage only
      const registered = server._registeredTools ?? {}
      const branded = registered['search_branded']
      const ui = (branded?._meta as { ui?: { icons?: Array<{ src: string }> } } | undefined)?.ui
      expect(ui?.icons?.[0]?.src).toBe('https://cdn.acme.test/icon.png')
    })

    it('respects an explicit opt-in descriptor-level UI link on payable tools (merchant override)', () => {
      // Text-only paywall is the default, but merchants who
      // deliberately want the iframe opened on every call can still
      // opt in by passing `meta: { ui: { resourceUri } }`. The
      // descriptor merge leaves explicit values untouched.
      const { server } = buildTestServer({
        additionalTools: ({ registerPayable, resourceUri }) => {
          registerPayable('always_open', {
            title: 'Always open (test)',
            schema: { query: z.string() },
            meta: { ui: { resourceUri } },
            handler: async () => ({ ok: true }),
          })
        },
      })
      // @ts-expect-error — private registry used for coverage only
      const registered = server._registeredTools ?? {}
      const alwaysOpen = registered['always_open']
      const ui = (alwaysOpen?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
      expect(ui?.resourceUri).toBe('ui://test/view.html')
    })

    it('advertises prefersBorder: false on the app UI resource (widget paints its own frame)', async () => {
      const { server } = buildTestServer()
      const { resources } = await listedResources(server)
      const entry = resources.find(r => r.uri === 'ui://test/view.html')
      const metaUi = (entry?._meta ?? entry?.metadata?._meta)?.ui
      expect(metaUi?.prefersBorder).toBe(false)
    })
  })
})
