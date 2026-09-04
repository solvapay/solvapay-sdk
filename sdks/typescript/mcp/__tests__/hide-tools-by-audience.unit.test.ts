/**
 * `hideToolsByAudience` — filters UI-audience tools out of `tools/list`
 * and rejects `tools/call` for those names. Regression guard for the
 * workaround the Goldberg Supabase Edge example used to do inline via
 * `(server as any).server._requestHandlers`.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MCP_TOOL_NAMES } from '@solvapay/mcp-core'
import { createSolvaPay } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import { createSolvaPayMcpServer } from '../src'

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

function buildServer(overrides: Partial<Parameters<typeof createSolvaPayMcpServer>[0]> = {}) {
  return createSolvaPayMcpServer({
    solvaPay: makeSolvaPay(),
    productRef: 'prd_test',
    resourceUri: 'ui://test/view.html',
    htmlPath: '/tmp/fake/view.html',
    publicBaseUrl: 'https://example.com',
    ...overrides,
  })
}

interface ToolListResponse {
  tools: Array<{ name: string; _meta?: { audience?: unknown } }>
}

async function invokeToolsList(
  server: ReturnType<typeof createSolvaPayMcpServer>,
  extra: Record<string, unknown> = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = (server as any).server._requestHandlers as Map<
    string,
    (req: unknown, extra: unknown) => Promise<ToolListResponse>
  >
  const handler = handlers.get('tools/list')
  if (!handler) throw new Error('tools/list handler not registered')
  return handler(
    { method: 'tools/list', params: {} },
    {
      signal: new AbortController().signal,
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
      ...extra,
    },
  )
}

const INTENT_TOOLS = [
  MCP_TOOL_NAMES.upgrade,
  MCP_TOOL_NAMES.manageAccount,
  MCP_TOOL_NAMES.topup,
  MCP_TOOL_NAMES.activatePlan,
]

const UI_TOOLS = [
  MCP_TOOL_NAMES.createCheckoutSession,
  MCP_TOOL_NAMES.createPayment,
  MCP_TOOL_NAMES.processPayment,
  MCP_TOOL_NAMES.createCustomerSession,
  MCP_TOOL_NAMES.createTopupPayment,
  MCP_TOOL_NAMES.attachBusinessDetails,
  MCP_TOOL_NAMES.cancelRenewal,
  MCP_TOOL_NAMES.reactivateRenewal,
]

describe('createSolvaPayMcpServer — hideToolsByAudience', () => {
  it('returns all 12 SolvaPay tools by default', async () => {
    const server = buildServer()
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name).sort()
    for (const name of [...INTENT_TOOLS, ...UI_TOOLS]) {
      expect(names).toContain(name)
    }
  })

  it('drops audience=ui tools from tools/list with hideToolsByAudience: ["ui"]', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name)
    for (const intent of INTENT_TOOLS) {
      expect(names).toContain(intent)
    }
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
  })

  it('does not invoke a hidden tool via tools/call', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = (server as any).server._requestHandlers as Map<
      string,
      (req: unknown, extra: unknown) => Promise<unknown>
    >
    const handler = handlers.get('tools/call')
    if (!handler) throw new Error('tools/call handler not registered')
    const result = await handler(
      {
        method: 'tools/call',
        params: { name: UI_TOOLS[0], arguments: {} },
      },
      {
        signal: new AbortController().signal,
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
        mcpReq: { requestState: () => undefined },
      },
    )
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: expect.any(Number) }),
      }),
    )
  })

  it('does not leak audience filter into a second server instance', async () => {
    // Paranoia: the filter mutates the MCP server's internal handler
    // map. A global cache bug would surface as the second instance
    // inheriting the first's filter. Guard against that here.
    buildServer({ hideToolsByAudience: ['ui'] })
    const fresh = buildServer()
    const { tools } = await invokeToolsList(fresh)
    const names = tools.map(t => t.name)
    for (const uiTool of UI_TOOLS) {
      expect(names).toContain(uiTool)
    }
  })

  it('tolerates an empty array (no filter applied)', async () => {
    const server = buildServer({ hideToolsByAudience: [] })
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name)
    for (const uiTool of UI_TOOLS) {
      expect(names).toContain(uiTool)
    }
  })

  it('drops descriptors on custom audiences too (["internal"])', async () => {
    // Sanity check the filter isn't hardcoded to the `"ui"` value —
    // any string matches by exact audience equality.
    const server = buildServer({
      hideToolsByAudience: ['internal'],
      additionalTools: ({ server: srv }) => {
        srv.registerTool(
          'debug_flush',
          {
            title: 'Debug flush',
            description: 'internal-only cache flush',
            inputSchema: { scope: z.string() },
            _meta: { audience: 'internal' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          async () => ({
            content: [{ type: 'text' as const, text: 'ok' }],
          }),
        )
      },
    })
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name)
    expect(names).not.toContain('debug_flush')
    // The regular SolvaPay tools (audience: 'ui' or no audience)
    // should still be present because we filtered on 'internal'.
    for (const intent of INTENT_TOOLS) {
      expect(names).toContain(intent)
    }
    for (const uiTool of UI_TOOLS) {
      expect(names).toContain(uiTool)
    }
  })
})

describe('createSolvaPayMcpServer — hideToolsByAudience does not trust User-Agent', () => {
  it('still hides audience=ui tools when User-Agent matches /openai-mcp/i', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    const { tools } = await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' } },
    })
    const names = tools.map(t => t.name)
    for (const intent of INTENT_TOOLS) {
      expect(names).toContain(intent)
    }
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
  })

  it('still hides audience=ui tools when getClientVersion() reports openai-mcp', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(server as any).server.getClientVersion = () => ({
      name: 'openai-mcp (ChatGPT)',
      version: '1.0.0',
    })
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name)
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
  })
})
