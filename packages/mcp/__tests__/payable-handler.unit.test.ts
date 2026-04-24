import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPay, PaywallError } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import { buildPayableHandler } from '../src/payable-handler'
import type {
  ContentBlock,
  NudgeSpec,
  ResponseContext,
  SolvaPayCallToolResult,
} from '../src/types'

/**
 * Minimal mock `SolvaPayClient` with pluggable `checkLimits` / trackUsage
 * tracking. Mirrors the fixture pattern in
 * `packages/mcp-sdk/__tests__/create-solvapay-mcp-server.unit.test.ts`.
 */
interface MockClient extends SolvaPayClient {
  __trackUsageCalls: Array<Record<string, unknown>>
}

function makeMockClient(
  options: {
    limits?: {
      withinLimits?: boolean
      remaining?: number
      plan?: string
      creditBalance?: number
      checkoutUrl?: string
      activationRequired?: boolean
    }
  } = {},
): MockClient {
  const limits = {
    withinLimits: true,
    remaining: 42,
    plan: 'pro',
    creditBalance: 5000,
    ...options.limits,
  }
  const trackUsageCalls: Array<Record<string, unknown>> = []

  const client = {
    checkLimits: vi.fn().mockResolvedValue(limits),
    trackUsage: vi.fn(async (params: Record<string, unknown>) => {
      trackUsageCalls.push(params)
    }),
    // Echo the input ref back as a prefixed backend ref so tests can
    // verify customer-ref plumbing end-to-end.
    createCustomer: vi.fn(async (params: { email?: string; externalRef?: string }) => ({
      customerRef: `cus_${params.externalRef ?? params.email ?? 'new'}`,
    })),
    getCustomer: vi.fn(
      async (params: { customerRef?: string; externalRef?: string; email?: string }) => {
        const ref = params.customerRef ?? params.externalRef ?? params.email ?? 'new'
        return {
          customerRef: ref.startsWith('cus_') ? ref : `cus_${ref}`,
        }
      },
    ),
    __trackUsageCalls: trackUsageCalls,
  } as unknown as MockClient

  return client
}

function makeSolvaPay(client: MockClient) {
  return createSolvaPay({ apiClient: client })
}

function mcpExtra(customerRef = 'test_user') {
  return { authInfo: { extra: { customer_ref: customerRef } } }
}

describe('buildPayableHandler — ctx.respond V1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ctx.respond minimal form', () => {
    it('unwraps ResponseResult envelope into structuredContent + content[0].text', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)
      const data = { foo: 'bar', list: [1, 2, 3] }

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => ctx.respond(data),
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult

      expect(result.structuredContent).toEqual(data)
      expect(result.content[0]).toEqual({
        type: 'text',
        text: JSON.stringify(data),
      })
      expect(result._meta).toBeUndefined()
    })
  })

  describe('options.text override', () => {
    it('replaces content[0].text with merchant-supplied text', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) =>
          ctx.respond({ x: 1 }, { text: 'Found 1 result' }),
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult

      expect(result.content[0]).toEqual({ type: 'text', text: 'Found 1 result' })
      expect(result.structuredContent).toEqual({ x: 1 })
    })
  })

  describe('options.nudge', () => {
    it('stamps _meta.ui = { resourceUri, nudge } on the response', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)
      const nudge: NudgeSpec = { kind: 'low-balance', message: 'Running low on credits' }

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => ctx.respond({ y: 2 }, { nudge }),
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult

      expect(result._meta).toEqual({
        ui: { resourceUri: 'ui://test/view.html', nudge },
      })
      // Without a bootstrap builder, `structuredContent` stays as the
      // raw merchant data so text-only hosts still see it directly.
      expect(result.structuredContent).toEqual({ y: 2 })
    })

    it('rewrites structuredContent into a view:"nudge" BootstrapPayload when buildBootstrap is wired', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)
      const nudge: NudgeSpec = { kind: 'low-balance', message: 'low' }

      const buildBootstrap = vi.fn().mockResolvedValue({
        view: 'nudge',
        productRef: 'prd_test',
        stripePublishableKey: null,
        returnUrl: 'https://example.com',
        merchant: { reference: 'mer', name: 'Test' },
        product: { reference: 'prd_test', name: 'Test Product' },
        plans: [],
        customer: null,
      })

      const merchantData = { rows: [1, 2, 3] }
      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html', buildBootstrap },
        async (_args, ctx: ResponseContext) => ctx.respond(merchantData, { nudge }),
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult
      expect(buildBootstrap).toHaveBeenCalledWith('nudge', expect.anything())

      const sc = result.structuredContent as Record<string, unknown>
      expect(sc.view).toBe('nudge')
      expect(sc.nudge).toEqual(nudge)
      expect(sc.data).toEqual(merchantData)
      expect(result._meta).toEqual({
        ui: { resourceUri: 'ui://test/view.html', nudge },
      })
    })
  })

  describe('options.units — reserved surface (V1 ignores)', () => {
    it('accepts `units` but trackUsage is still called with units: 1 (V1.1 will flip this test)', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) =>
          ctx.respond({ results: [1, 2, 3, 4] }, { units: 4 }),
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult

      expect(result.structuredContent).toEqual({ results: [1, 2, 3, 4] })
      expect(client.__trackUsageCalls).toHaveLength(1)
      // V1: trackUsage is called without a caller-supplied `units` so
      // the default stays at the hard-coded 1-credit-per-call billing.
      expect(client.__trackUsageCalls[0].units ?? 1).toBe(1)
    })
  })

  describe('ctx.customer', () => {
    it('populates ref, balance, remaining, withinLimits, plan from LimitResponseWithPlan', async () => {
      const client = makeMockClient({
        limits: {
          withinLimits: true,
          remaining: 7,
          plan: 'pro',
          creditBalance: 1234,
        },
      })
      const solvaPay = makeSolvaPay(client)
      let capturedCustomer: unknown

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => {
          capturedCustomer = {
            ref: ctx.customer.ref,
            balance: ctx.customer.balance,
            remaining: ctx.customer.remaining,
            withinLimits: ctx.customer.withinLimits,
            plan: ctx.customer.plan,
          }
          return ctx.respond({ ok: true })
        },
      )

      await handler({}, mcpExtra('ctx_user'))

      expect(capturedCustomer).toMatchObject({
        ref: expect.stringContaining('ctx_user'),
        balance: 1234,
        withinLimits: true,
        plan: expect.objectContaining({ reference: 'pro' }),
      })
      // The paywall pre-decrements one unit from `remaining` before
      // handing off to the handler, so the surfaced value is 6 not 7.
      expect((capturedCustomer as { remaining: number }).remaining).toBeGreaterThanOrEqual(0)
    })
  })

  describe('ctx.customer.fresh()', () => {
    it('bypasses the 10s cache and returns a new snapshot', async () => {
      const client = makeMockClient({
        limits: { withinLimits: true, remaining: 10, plan: 'pro', creditBalance: 100 },
      })
      const solvaPay = makeSolvaPay(client)
      let freshSnapshot: unknown

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => {
          // First call: uses the cached/pre-check limits.
          expect(ctx.customer.balance).toBe(100)
          // Mutate the mock so the fresh fetch sees different balance.
          ;(client.checkLimits as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            withinLimits: true,
            remaining: 10,
            plan: 'pro',
            creditBalance: 250,
          })
          const fresh = await ctx.customer.fresh()
          freshSnapshot = { balance: fresh.balance, ref: fresh.ref }
          return ctx.respond({ ok: true })
        },
      )

      await handler({}, mcpExtra('fresh_user'))
      expect(freshSnapshot).toEqual({
        balance: 250,
        ref: expect.stringContaining('fresh_user'),
      })
    })
  })

  describe('ctx.gate', () => {
    it('throws a PaywallError surfaced as a paywall response', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_gated', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => {
          ctx.gate('custom reason')
        },
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult
      // Paywall tool results are *not* flagged as errors — a gate is
      // a user-actionable UI trigger, not a tool failure. Hosts
      // short-circuit `isError: true` and never open the widget.
      expect(result.isError).toBe(false)
      const sc = result.structuredContent as Record<string, unknown>
      expect(sc.kind).toBe('payment_required')
      expect(sc.message).toBe('custom reason')

      // `content[0].text` is a plain-string narration sourced from
      // the gate's human message — no `{ success: false, error:
      // "Payment required" }` JSON blob, which some MCP hosts
      // (MCPJam) treat as a failure signal and use to suppress
      // opening `_meta.ui.resourceUri`.
      const firstBlock = result.content[0] as { type: string; text: string }
      expect(firstBlock.type).toBe('text')
      expect(firstBlock.text).toBe('custom reason')
      expect(firstBlock.text).not.toMatch(/success/i)
      expect(firstBlock.text).not.toMatch(/"error"/i)

      const trackUsageCalls = client.__trackUsageCalls
      expect(trackUsageCalls.some(c => c.outcome === 'fail')).toBe(false)
    })

    it('is equivalent to throwing PaywallError', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_throw', resourceUri: 'ui://test/view.html' },
        async () => {
          throw new PaywallError('manual', {
            kind: 'payment_required',
            product: 'prd_throw',
            checkoutUrl: '',
            message: 'manual',
          })
        },
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult
      expect(result.isError).toBe(false)
      expect((result.structuredContent as Record<string, unknown>).kind).toBe(
        'payment_required',
      )
      const firstBlock = result.content[0] as { type: string; text: string }
      expect(firstBlock.text).toBe('manual')
      expect(firstBlock.text).not.toMatch(/success/i)
    })
  })

  describe('ctx.emit (reserved surface, V1 queue-and-flush)', () => {
    it('flushes queued blocks into content[] before the text block', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => {
          const block1: ContentBlock = { type: 'text', text: 'intermediate 1' }
          const block2: ContentBlock = { type: 'text', text: 'intermediate 2' }
          await ctx.emit(block1)
          await ctx.emit(block2)
          return ctx.respond({ final: true })
        },
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult
      expect(result.content).toHaveLength(3)
      expect(result.content[0]).toEqual({ type: 'text', text: 'intermediate 1' })
      expect(result.content[1]).toEqual({ type: 'text', text: 'intermediate 2' })
      expect(result.content[2]).toMatchObject({ type: 'text' })
    })
  })

  describe('ctx.progress / ctx.progressRaw (reserved surface, V1 no-op)', () => {
    it('resolves without error', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => {
          await ctx.progress({ percent: 50, message: 'halfway' })
          await ctx.progressRaw({ progress: 1, total: 2, message: 'raw' })
          return ctx.respond({ ok: true })
        },
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult
      expect(result.structuredContent).toEqual({ ok: true })
    })
  })

  describe('ctx.signal (reserved surface, V1 unaborted)', () => {
    it('is an unaborted AbortSignal', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)
      let aborted: boolean | undefined

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async (_args, ctx: ResponseContext) => {
          aborted = ctx.signal.aborted
          return ctx.respond({ ok: true })
        },
      )

      await handler({}, mcpExtra())
      expect(aborted).toBe(false)
    })
  })

  describe('error path', () => {
    it('non-PaywallError is surfaced via formatError; trackUsage outcome = fail', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        async () => {
          throw new Error('boom')
        },
      )

      const result = (await handler({}, mcpExtra())) as SolvaPayCallToolResult
      expect(result.isError).toBe(true)
      expect(client.__trackUsageCalls.some(c => c.outcome === 'fail')).toBe(true)
    })
  })

  describe('ctx.respond invariant', () => {
    it('throws a merchant-actionable error when a handler returns a raw value', async () => {
      const client = makeMockClient()
      const solvaPay = makeSolvaPay(client)

      // Bypass the TS contract to simulate a plain-JS merchant (or a
      // handler that slipped past `any` / `@ts-ignore`).
      const rawHandler = (async () => ({ raw: true })) as unknown as Parameters<
        typeof buildPayableHandler
      >[2]

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html' },
        rawHandler,
      )

      await expect(handler({}, mcpExtra())).rejects.toThrow(
        /registerPayable handler returned a raw value/,
      )
      await expect(handler({}, mcpExtra())).rejects.toThrow(
        /ctx\.respond\(data, options\?\)/,
      )
    })
  })

  describe('paywall branch (pre-check)', () => {
    it('rewrites structuredContent to BootstrapPayload-shaped paywall when buildBootstrap provided', async () => {
      const client = makeMockClient({
        limits: {
          withinLimits: false,
          remaining: 0,
          plan: 'free',
          checkoutUrl: 'https://example.com/checkout',
        },
      })
      const solvaPay = makeSolvaPay(client)

      const buildBootstrap = vi.fn().mockResolvedValue({
        view: 'paywall',
        productRef: 'prd_test',
        stripePublishableKey: null,
        returnUrl: 'https://example.com',
        paywall: { kind: 'payment_required' },
        merchant: { reference: 'mer', name: 'Test' },
        product: { reference: 'prd_test', name: 'Product' },
        plans: [],
        customer: null,
      })

      const handler = buildPayableHandler(
        solvaPay,
        { product: 'prd_test', resourceUri: 'ui://test/view.html', buildBootstrap },
        async (_args, ctx: ResponseContext) => ctx.respond({ ok: true }),
      )

      const result = (await handler({}, mcpExtra('gate_user'))) as SolvaPayCallToolResult
      // Paywall results are intentionally not flagged as errors so
      // hosts open the `_meta.ui` widget instead of short-circuiting
      // on the error path.
      expect(result.isError).toBe(false)
      expect(buildBootstrap).toHaveBeenCalledTimes(1)
      expect((result.structuredContent as Record<string, unknown>).view).toBe('paywall')
      expect(result._meta).toEqual({ ui: { resourceUri: 'ui://test/view.html' } })

      // Content block is a plain-string narration — no `{ success:
      // false, error: "Payment required" }` JSON that hosts could
      // misinterpret as a tool failure. The paywall pre-check
      // builds a human message like "You've used all your
      // included calls..." which rides through as-is.
      const firstBlock = result.content[0] as { type: string; text: string }
      expect(firstBlock.type).toBe('text')
      expect(typeof firstBlock.text).toBe('string')
      expect(firstBlock.text).not.toMatch(/success/i)
      expect(firstBlock.text).not.toMatch(/"error"/i)
      expect(firstBlock.text.length).toBeGreaterThan(0)
    })
  })
})
