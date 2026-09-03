/**
 * Regression: `@modelcontextprotocol/server` 2.x validates `structuredContent`
 * against the registered `outputSchema` after every `tools/call`. Merchant
 * payable tools must return flat merchant data on success (not the
 * `ctx.respond()` envelope) and must accept paywall gates without an
 * "Output validation error".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { createSolvaPay } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import type { ResponseContext } from '@solvapay/mcp-core'
import { createSolvaPayMcpServer } from '../src'

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('<html></html>'),
  },
}))

const directionOutputSchema = z.object({
  symbol: z.string(),
  days: z.number(),
  direction: z.enum(['up', 'down']),
  confidence: z.number(),
  asOf: z.string(),
})

function makeSolvaPay(overrides: { withinLimits?: boolean } = {}) {
  const withinLimits = overrides.withinLimits ?? true
  const client = {
    checkLimits: vi.fn().mockResolvedValue({
      withinLimits,
      remaining: withinLimits ? 1 : 0,
      plan: 'free',
    }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_new' }),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_existing' }),
    createCheckoutSession: vi
      .fn()
      .mockResolvedValue({ sessionId: 'sess_1', checkoutUrl: 'https://example.com/checkout' }),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
  } as unknown as SolvaPayClient
  return createSolvaPay({ apiClient: client })
}

function buildServer(solvaPay: ReturnType<typeof createSolvaPay>) {
  return createSolvaPayMcpServer({
    solvaPay,
    productRef: 'prd_test',
    resourceUri: 'ui://test/view.html',
    htmlPath: '/tmp/fake/view.html',
    publicBaseUrl: 'https://example.com',
    additionalTools: ({ registerPayable }) => {
      registerPayable('predict_direction', {
        product: 'prd_test',
        schema: {
          symbol: z.string(),
          days: z.number(),
        },
        outputSchema: directionOutputSchema,
        handler: async ({ symbol, days }, ctx: ResponseContext) =>
          ctx.respond(
            {
              symbol: String(symbol).toUpperCase(),
              days,
              direction: 'up' as const,
              confidence: 0.82,
              asOf: '2026-04-24T00:00:00.000Z',
            },
            { text: `${symbol} verdict` },
          ),
      })
    },
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
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = (server as any).server._requestHandlers as Map<
    string,
    (req: unknown, extra: unknown) => Promise<ToolCallResult>
  >
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
      mcpReq: {
        requestState: () => undefined,
        signal,
        send: vi.fn(),
        notify: vi.fn(),
      },
    },
  )
}

function outputValidationMessage(result: ToolCallResult): string | undefined {
  const block = result.content?.find(c => c.type === 'text')
  return block?.text?.includes('Output validation error') ? block.text : undefined
}

describe('registerPayable — outputSchema + tools/call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns flat merchant structuredContent that passes outputSchema validation', async () => {
    const server = buildServer(makeSolvaPay())
    const result = await invokeToolsCall(server, 'predict_direction', {
      symbol: 'AAPL',
      days: 10,
    })

    expect(result.isError).toBeFalsy()
    expect(outputValidationMessage(result)).toBeUndefined()
    expect(result.structuredContent).toEqual({
      symbol: 'AAPL',
      days: 10,
      direction: 'up',
      confidence: 0.82,
      asOf: '2026-04-24T00:00:00.000Z',
    })
    expect(result.structuredContent).not.toHaveProperty('__solvapayResponse')
    expect(result.structuredContent).not.toHaveProperty('data')
  })

  it('does not fail output validation when checkLimits blocks the call', async () => {
    const server = buildServer(makeSolvaPay({ withinLimits: false }))
    const result = await invokeToolsCall(server, 'predict_direction', {
      symbol: 'AAPL',
      days: 10,
    })

    expect(result.isError).toBeFalsy()
    expect(outputValidationMessage(result)).toBeUndefined()
    expect(result.structuredContent?.kind).toBe('payment_required')
    expect(typeof result.structuredContent?.checkoutUrl).toBe('string')
    expect(typeof result.structuredContent?.message).toBe('string')
  })
})
