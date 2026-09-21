import { describe, expect, it, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createSolvaPay } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import { PaywallStructuredContentSchema } from '@solvapay/server'
import type { ResponseContext } from '@solvapay/mcp-core'
import { createSolvaPayMcpServer } from '../src'

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('<html></html>'),
  },
}))

const PREVIEW_ALLOWANCE = {
  meter: 'free-previews',
  cap: 5,
  scope: 'rolling_window' as const,
  windowDays: 30,
}

function makeSolvaPay(overrides: { withinLimits?: boolean } = {}) {
  const withinLimits = overrides.withinLimits ?? true
  const client = {
    checkLimits: vi.fn().mockResolvedValue({
      withinLimits,
      remaining: withinLimits ? 2 : 0,
      used: withinLimits ? 3 : 5,
      limit: 5,
      meterName: 'free-previews',
      ...(withinLimits
        ? {}
        : {
            paywallReason: 'limit_reached',
            checkoutUrl: 'https://example.com/checkout',
            plans: [
              {
                reference: 'pln_pro',
                name: 'Pro',
                type: 'recurring',
                price: 1800,
                currency: 'USD',
                requiresPayment: true,
                checkoutUrl: 'https://example.com/checkout',
              },
            ],
          }),
    }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_new' }),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_existing' }),
    createCheckoutSession: vi
      .fn()
      .mockResolvedValue({ sessionId: 'sess_1', checkoutUrl: 'https://example.com/checkout' }),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
  } as unknown as SolvaPayClient
  return { solvaPay: createSolvaPay({ apiClient: client }), client }
}

function buildServer(
  solvaPay: ReturnType<typeof createSolvaPay>,
  register: (ctx: {
    registerFree: Parameters<
      NonNullable<Parameters<typeof createSolvaPayMcpServer>[0]['additionalTools']>
    >[0]['registerFree']
  }) => void,
) {
  return createSolvaPayMcpServer({
    solvaPay,
    productRef: 'prd_test',
    resourceUri: 'ui://test/view.html',
    htmlPath: '/tmp/fake/view.html',
    publicBaseUrl: 'https://example.com',
    additionalTools: ctx => register(ctx),
  })
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

async function invokeToolsCall(
  server: ReturnType<typeof createSolvaPayMcpServer>,
  name: string,
  args: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  const handlers = (
    server as unknown as {
      server: {
        _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<ToolCallResult>>
      }
    }
  ).server._requestHandlers
  const handler = handlers.get('tools/call')
  if (!handler) throw new Error('tools/call handler not registered')
  const signal = new AbortController().signal
  return handler(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    {
      signal,
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
      mcpReq: {
        requestState: () => undefined,
        signal,
        send: vi.fn(),
        notify: vi.fn(),
      },
      ...extra,
    },
  )
}

const identified = {
  authInfo: { extra: { customer_ref: 'cus_42' } },
  http: { authInfo: { extra: { customer_ref: 'cus_42' } } },
}

describe('registerFree — guards', () => {
  it('rejects a meter that does not start with free-', () => {
    const { solvaPay } = makeSolvaPay()
    expect(() =>
      buildServer(solvaPay, ({ registerFree }) => {
        registerFree('preview_quote', {
          limit: { meter: 'previews', cap: 5, scope: 'lifetime' },
          handler: async (_args, ctx: ResponseContext) => ctx.respond({ ok: true }),
        })
      }),
    ).toThrow(/free-\[a-z0-9-\]\+/)
  })

  it('rejects two tools on one meter with mismatched caps, naming both tools', () => {
    const { solvaPay } = makeSolvaPay()
    expect(() =>
      buildServer(solvaPay, ({ registerFree }) => {
        registerFree('preview_quote', {
          limit: PREVIEW_ALLOWANCE,
          handler: async (_args, ctx: ResponseContext) => ctx.respond({ ok: true }),
        })
        registerFree('preview_profile', {
          limit: { ...PREVIEW_ALLOWANCE, cap: 20 },
          handler: async (_args, ctx: ResponseContext) => ctx.respond({ ok: true }),
        })
      }),
    ).toThrow(/preview_quote.*preview_profile/)
  })
})

describe('registerFree — tools/call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns merchant data on allow', async () => {
    const { solvaPay } = makeSolvaPay()
    const server = buildServer(solvaPay, ({ registerFree }) => {
      registerFree('preview_quote', {
        schema: { symbol: z.string() },
        limit: PREVIEW_ALLOWANCE,
        handler: async ({ symbol }, ctx: ResponseContext) =>
          ctx.respond({ symbol: String(symbol).toUpperCase(), price: 1 }),
      })
    })

    const result = await invokeToolsCall(server, 'preview_quote', { symbol: 'aapl' }, identified)

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ symbol: 'AAPL', price: 1 })
  })

  it('returns a valid PaywallStructuredContent when the allowance is exhausted', async () => {
    const { solvaPay } = makeSolvaPay({ withinLimits: false })
    const server = buildServer(solvaPay, ({ registerFree }) => {
      registerFree('preview_quote', {
        schema: { symbol: z.string() },
        limit: PREVIEW_ALLOWANCE,
        outputSchema: z.object({ symbol: z.string(), price: z.number() }),
        handler: async (_args, ctx: ResponseContext) => ctx.respond({ symbol: 'AAPL', price: 1 }),
      })
    })

    const result = await invokeToolsCall(server, 'preview_quote', { symbol: 'aapl' }, identified)

    expect(result.isError).toBeFalsy()
    const parsed = PaywallStructuredContentSchema.parse(result.structuredContent)
    expect(parsed.reason ?? parsed.kind).toBeTruthy()
  })

  it('returns a 401 envelope when the caller is unidentified', async () => {
    const { solvaPay } = makeSolvaPay()
    const server = buildServer(solvaPay, ({ registerFree }) => {
      registerFree('preview_quote', {
        limit: PREVIEW_ALLOWANCE,
        handler: async (_args, ctx: ResponseContext) => ctx.respond({ ok: true }),
      })
    })

    const result = await invokeToolsCall(server, 'preview_quote')

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ status: 401 })
  })
})
