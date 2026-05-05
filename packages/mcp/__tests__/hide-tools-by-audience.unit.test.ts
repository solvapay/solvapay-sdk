/**
 * `hideToolsByAudience` — filters UI-audience tools out of `tools/list`
 * without disabling them. Regression guard for the workaround the
 * Goldberg Supabase Edge example used to do inline via
 * `(server as any).server._requestHandlers`.
 *
 * Also covers the ChatGPT auto-bypass added after PR #171's first
 * round (the goldberg-demo prod outage where the iframe couldn't call
 * hidden transport tools — see solvapay-frontend
 * /.cursor/plans/investigate_goldberg_topup_failure_ff1187a7.plan.md).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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

function buildServer(
  overrides: Partial<Parameters<typeof createSolvaPayMcpServer>[0]> = {},
) {
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
  MCP_TOOL_NAMES.cancelRenewal,
  MCP_TOOL_NAMES.reactivateRenewal,
]

describe('createSolvaPayMcpServer — hideToolsByAudience', () => {
  it('returns all 11 SolvaPay tools by default', async () => {
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

  it('leaves the hidden tools callable via tools/call (enabled: true)', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registered = (server as any)._registeredTools as Record<
      string,
      { enabled: boolean }
    >
    for (const uiTool of UI_TOOLS) {
      expect(registered[uiTool]?.enabled).toBe(true)
    }
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

// Verified live against `openai-mcp/1.0.0 (ChatGPT)` on goldberg-demo
// (probe captured 2026-05-04). The pattern is liberal so a UA bump
// like `openai-mcp/2.0.0` keeps working without changes.
describe('createSolvaPayMcpServer — hideToolsByAudience ChatGPT auto-bypass', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('serves the full catalog when User-Agent matches /openai-mcp/i', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    const { tools } = await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' } },
    })
    const names = tools.map(t => t.name)
    for (const tool of [...INTENT_TOOLS, ...UI_TOOLS]) {
      expect(names).toContain(tool)
    }
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/hideToolsByAudience filter bypassed/)
  })

  it('matches the pattern liberally — survives a UA version bump (openai-mcp/2.0.0)', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    const { tools } = await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/2.0.0 (ChatGPT-NextGen)' } },
    })
    const names = tools.map(t => t.name)
    for (const uiTool of UI_TOOLS) {
      expect(names).toContain(uiTool)
    }
  })

  it('still applies the filter when User-Agent is a non-ChatGPT MCP client', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    const { tools } = await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'Claude-Desktop/1.2.3' } },
    })
    const names = tools.map(t => t.name)
    for (const intent of INTENT_TOOLS) {
      expect(names).toContain(intent)
    }
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('still applies the filter when no requestInfo is present (stdio transport)', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name)
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
  })

  it('serves the full catalog when getClientVersion() reports openai-mcp', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    // Simulate a successful initialize having landed on this server
    // instance — the SDK normally populates `_clientVersion` via the
    // initialize handler. We patch it directly because the test
    // bypasses the full handshake.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(server as any).server._clientVersion = { name: 'openai-mcp (ChatGPT)', version: '1.0.0' }
    const { tools } = await invokeToolsList(server)
    const names = tools.map(t => t.name)
    for (const uiTool of UI_TOOLS) {
      expect(names).toContain(uiTool)
    }
  })

  it('integrator-supplied bypassWhen overrides the default ChatGPT detection', async () => {
    const bypassWhen = vi.fn().mockReturnValue(false)
    const server = buildServer({
      hideToolsByAudience: { audiences: ['ui'], bypassWhen },
    })
    const { tools } = await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' } },
    })
    const names = tools.map(t => t.name)
    // Filter applied because bypassWhen returned false even for a
    // ChatGPT UA — the override beats the default.
    for (const uiTool of UI_TOOLS) {
      expect(names).not.toContain(uiTool)
    }
    expect(bypassWhen).toHaveBeenCalled()
  })

  it('bypass log message is host-neutral even when a custom predicate fires for a non-ChatGPT host', async () => {
    // Regression for the Bugbot finding on PR #171: the original log
    // message hardcoded "ChatGPT-detected request" which would lie to
    // operators when an integrator-supplied predicate matched on a
    // different host. The message should describe the request context
    // (User-Agent), not what the predicate matched on.
    const server = buildServer({
      hideToolsByAudience: {
        audiences: ['ui'],
        bypassWhen: ctx =>
          /future-iframe-host/i.test(
            (ctx.extra?.requestInfo?.headers?.['user-agent'] as string | undefined) ?? '',
          ),
      },
    })
    await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'future-iframe-host/0.1.0' } },
    })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0]?.[0] as string
    expect(msg).toMatch(/hideToolsByAudience filter bypassed/)
    expect(msg).toContain('future-iframe-host/0.1.0')
    expect(msg).not.toMatch(/chatgpt/i)
  })

  it('throttles the bypass warning to one log per cause per server instance', async () => {
    const server = buildServer({ hideToolsByAudience: ['ui'] })
    await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' } },
    })
    await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' } },
    })
    await invokeToolsList(server, {
      requestInfo: { headers: { 'user-agent': 'openai-mcp/1.0.0 (ChatGPT)' } },
    })
    // Same cause string ⇒ logged once; subsequent calls stay quiet so
    // production tails don't drown in identical warnings.
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
