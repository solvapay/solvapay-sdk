import { describe, it, expect, vi } from 'vitest'
import {
  classifyHostEntry,
  fetchMcpBootstrap,
  isTransportToolName,
  parseBootstrapFromToolResult,
  SOLVAPAY_TRANSPORT_TOOL_NAMES,
  waitForInitialToolResult,
} from '../bootstrap'
import type { McpAppBootstrapLike } from '../bootstrap'

function mockApp(opts: {
  toolName?: string
  structuredContent?: unknown
  isError?: boolean
  text?: string
}): McpAppBootstrapLike {
  return {
    callServerTool: vi.fn().mockResolvedValue({
      isError: opts.isError,
      structuredContent: opts.structuredContent,
      content: opts.text ? [{ type: 'text', text: opts.text }] : undefined,
    }),
    getHostContext: () =>
      opts.toolName ? { toolInfo: { tool: { name: opts.toolName } } } : undefined,
  }
}

describe('fetchMcpBootstrap', () => {
  it('routes to upgrade by default and returns the bootstrap payload', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        stripePublishableKey: 'pk_test_abc',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'upgrade',
      arguments: {},
    })
    expect(result).toEqual({
      view: 'checkout',
      productRef: 'prod_123',
      stripePublishableKey: 'pk_test_abc',
      returnUrl: 'https://example.test/return',
      merchant: {},
      product: { reference: 'prod_123' },
      plans: [],
      customer: null,
    })
  })

  it('infers view from host toolInfo.tool.name', async () => {
    const app = mockApp({
      toolName: 'topup',
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)

    expect(app.callServerTool).toHaveBeenCalledWith({
      name: 'topup',
      arguments: {},
    })
    expect(result.view).toBe('topup')
    expect(result.stripePublishableKey).toBeNull()
  })

  it('falls back to checkout when the host invoked activate_plan (the picker now lives in checkout)', async () => {
    const app = mockApp({
      toolName: 'activate_plan',
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'https://example.test/return',
      },
    })

    const result = await fetchMcpBootstrap(app)
    expect(result.view).toBe('checkout')
  })

  it('throws when the tool response has no productRef', async () => {
    const app = mockApp({
      structuredContent: { returnUrl: 'https://example.test/return' },
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow(/productRef/)
  })

  it('throws when returnUrl is not an http(s) URL', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        returnUrl: 'ui://bad',
      },
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow(/valid http\(s\) returnUrl/)
  })

  it('forwards enriched merchant/product/plans/customer from structuredContent', async () => {
    const app = mockApp({
      structuredContent: {
        productRef: 'prod_123',
        stripePublishableKey: 'pk_test_abc',
        returnUrl: 'https://example.test/return',
        merchant: { displayName: 'Acme', legalName: 'Acme Inc' },
        product: { reference: 'prod_123', name: 'Widget' },
        plans: [{ reference: 'pln_basic' }],
        customer: {
          ref: 'cus_42',
          purchase: { customerRef: 'cus_42', purchases: [] },
          paymentMethod: { kind: 'none' },
          balance: null,
          usage: null,
        },
      },
    })
    const result = await fetchMcpBootstrap(app)
    expect(result.merchant).toMatchObject({ displayName: 'Acme' })
    expect(result.product).toMatchObject({ name: 'Widget' })
    expect(result.plans).toHaveLength(1)
    expect(result.customer?.ref).toBe('cus_42')
  })

  it('propagates tool errors with the server text message', async () => {
    const app = mockApp({
      isError: true,
      text: 'customer_ref missing',
    })

    await expect(fetchMcpBootstrap(app)).rejects.toThrow('customer_ref missing')
  })
})

describe('parseBootstrapFromToolResult — data-tool paywall/nudge entries', () => {
  it('parses a paywall response driven by a non-intent tool name (isError: true + embedded bootstrap)', () => {
    const bootstrap = parseBootstrapFromToolResult(
      {
        isError: true,
        structuredContent: {
          view: 'paywall',
          productRef: 'prd_7TGKZI27',
          stripePublishableKey: 'pk_test_abc',
          returnUrl: 'https://example.test/r',
          merchant: { displayName: 'Acme' },
          product: { reference: 'prd_7TGKZI27' },
          plans: [{ reference: 'pln_ub', planType: 'usage-based' }],
          customer: { ref: 'cus_7' },
          paywall: {
            kind: 'payment_required',
            product: 'prd_7TGKZI27',
            message: 'Purchase required. Remaining: 0',
          },
        },
      },
      // Data tool name that isn't in TOOL_FOR_VIEW — the parser should
      // still honour `structuredContent.view`.
      'search_knowledge',
      // Caller passes `paywall` as the fallback, but the structured
      // content's `view` wins regardless.
      'paywall',
    )
    expect(bootstrap.view).toBe('paywall')
    expect(bootstrap.productRef).toBe('prd_7TGKZI27')
    expect(bootstrap.paywall).toMatchObject({
      kind: 'payment_required',
      message: 'Purchase required. Remaining: 0',
    })
  })

  it('parses a nudge response driven by a non-intent tool name and preserves merchant data', () => {
    const merchantData = { range: '7d', results: [{ date: '2026-01-01', units: 12 }] }
    const bootstrap = parseBootstrapFromToolResult(
      {
        structuredContent: {
          view: 'nudge',
          productRef: 'prd_7TGKZI27',
          returnUrl: 'https://example.test/r',
          nudge: { kind: 'low-balance', message: 'top up' },
          data: merchantData,
        },
      },
      'query_sales_trends',
      'nudge',
    )
    expect(bootstrap.view).toBe('nudge')
    expect(bootstrap.nudge).toEqual({ kind: 'low-balance', message: 'top up' })
    expect(bootstrap.data).toEqual(merchantData)
  })

  it('falls back to the caller-provided view when structuredContent omits `view`', () => {
    const bootstrap = parseBootstrapFromToolResult(
      {
        structuredContent: {
          productRef: 'prd_7TGKZI27',
          returnUrl: 'https://example.test/r',
        },
      },
      'search_knowledge',
      'paywall',
    )
    expect(bootstrap.view).toBe('paywall')
  })

  it('throws when an errored response has no recognizable bootstrap shape', () => {
    expect(() =>
      parseBootstrapFromToolResult(
        {
          isError: true,
          content: [{ type: 'text', text: 'customer_ref missing' }],
        },
        'search_knowledge',
        'paywall',
      ),
    ).toThrow('customer_ref missing')
  })
})

describe('classifyHostEntry', () => {
  function mkApp(toolName?: string): McpAppBootstrapLike {
    return {
      callServerTool: vi.fn(),
      getHostContext: () =>
        toolName ? { toolInfo: { tool: { name: toolName } } } : undefined,
    }
  }

  it('classifies intent-tool entries with their matching view', () => {
    expect(classifyHostEntry(mkApp('upgrade'))).toEqual({
      kind: 'intent',
      toolName: 'upgrade',
      view: 'checkout',
    })
    expect(classifyHostEntry(mkApp('manage_account'))).toEqual({
      kind: 'intent',
      toolName: 'manage_account',
      view: 'account',
    })
    expect(classifyHostEntry(mkApp('topup'))).toEqual({
      kind: 'intent',
      toolName: 'topup',
      view: 'topup',
    })
  })

  it('classifies merchant-registered tools as `data`', () => {
    expect(classifyHostEntry(mkApp('search_knowledge'))).toEqual({
      kind: 'data',
      toolName: 'search_knowledge',
    })
    expect(classifyHostEntry(mkApp('query_sales_trends'))).toEqual({
      kind: 'data',
      toolName: 'query_sales_trends',
    })
  })

  it('classifies SolvaPay transport tools as `other`', () => {
    expect(classifyHostEntry(mkApp('create_payment_intent'))).toEqual({
      kind: 'other',
      toolName: 'create_payment_intent',
    })
    expect(classifyHostEntry(mkApp('activate_plan'))).toEqual({
      kind: 'other',
      toolName: 'activate_plan',
    })
  })

  it('classifies missing host context as `other` with no tool name', () => {
    expect(classifyHostEntry(mkApp())).toEqual({ kind: 'other' })
  })
})

describe('isTransportToolName / SOLVAPAY_TRANSPORT_TOOL_NAMES', () => {
  it('includes payment / session / renewal / activation tools', () => {
    for (const name of [
      'create_payment_intent',
      'process_payment',
      'create_topup_payment_intent',
      'cancel_renewal',
      'reactivate_renewal',
      'activate_plan',
      'create_checkout_session',
      'create_customer_session',
    ]) {
      expect(isTransportToolName(name)).toBe(true)
      expect(SOLVAPAY_TRANSPORT_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it('excludes intent tools and merchant-registered tools', () => {
    for (const name of ['upgrade', 'manage_account', 'topup']) {
      expect(isTransportToolName(name)).toBe(false)
    }
    for (const name of ['search_knowledge', 'query_sales_trends', 'some_other_tool']) {
      expect(isTransportToolName(name)).toBe(false)
    }
  })
})

describe('waitForInitialToolResult', () => {
  interface EventfulApp extends McpAppBootstrapLike {
    addEventListener: (
      evt: string,
      handler: (params: unknown) => void,
    ) => void
    removeEventListener: (
      evt: string,
      handler: (params: unknown) => void,
    ) => void
    ontoolresult?: ((params: unknown) => void) | undefined
  }

  function mkEventfulApp(toolName: string): {
    app: EventfulApp
    fire: (params: unknown) => void
    listeners: Record<string, Array<(params: unknown) => void>>
  } {
    const listeners: Record<string, Array<(params: unknown) => void>> = {}
    const app: EventfulApp = {
      callServerTool: vi.fn(),
      getHostContext: () => ({ toolInfo: { tool: { name: toolName } } }),
      addEventListener: (evt, handler) => {
        ;(listeners[evt] ??= []).push(handler)
      },
      removeEventListener: (evt, handler) => {
        const bucket = listeners[evt] ?? []
        const idx = bucket.indexOf(handler)
        if (idx >= 0) bucket.splice(idx, 1)
      },
    }
    const fire = (params: unknown) => {
      for (const h of listeners['toolresult'] ?? []) h(params)
    }
    return { app, fire, listeners }
  }

  it('resolves with the parsed bootstrap on the first non-error notification', async () => {
    const { app, fire } = mkEventfulApp('search_knowledge')
    const promise = waitForInitialToolResult(app, { timeoutMs: 1000 })

    // Fire in the next microtask so the helper has registered.
    await Promise.resolve()
    fire({
      structuredContent: {
        view: 'paywall',
        productRef: 'prd_7TGKZI27',
        returnUrl: 'https://example.test/r',
        paywall: { kind: 'payment_required', product: 'prd_7TGKZI27' },
      },
    })

    const outcome = await promise
    expect(outcome.timedOut).toBe(false)
    if (outcome.timedOut) return
    expect(outcome.toolName).toBe('search_knowledge')
    expect(outcome.bootstrap.view).toBe('paywall')
    expect(outcome.bootstrap.productRef).toBe('prd_7TGKZI27')
  })

  it('ignores notifications for transport tools and keeps waiting', async () => {
    const { app, fire, listeners } = mkEventfulApp('search_knowledge')
    const promise = waitForInitialToolResult(app, { timeoutMs: 1000 })
    await Promise.resolve()

    // Swap the host context's tool name to a transport tool, fire
    // there, then swap back and fire the real paywall.
    const hostContext: { toolInfo: { tool: { name: string } } } = {
      toolInfo: { tool: { name: 'create_payment_intent' } },
    }
    ;(app as unknown as { getHostContext: () => typeof hostContext }).getHostContext =
      () => hostContext
    fire({
      structuredContent: { view: 'paywall', productRef: 'prd_x', returnUrl: 'https://e/r' },
    })
    expect(listeners['toolresult']?.length).toBe(1)

    hostContext.toolInfo.tool.name = 'search_knowledge'
    fire({
      structuredContent: {
        view: 'paywall',
        productRef: 'prd_7TGKZI27',
        returnUrl: 'https://example.test/r',
      },
    })

    const outcome = await promise
    expect(outcome.timedOut).toBe(false)
    if (outcome.timedOut) return
    expect(outcome.bootstrap.productRef).toBe('prd_7TGKZI27')
  })

  it('resolves with timedOut=true after the timeout elapses', async () => {
    const { app } = mkEventfulApp('search_knowledge')
    const outcome = await waitForInitialToolResult(app, { timeoutMs: 10 })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.bootstrap).toBeNull()
  })

  it('falls back to the legacy `ontoolresult` setter when addEventListener is unavailable', async () => {
    const app: McpAppBootstrapLike & { ontoolresult?: (params: unknown) => void } = {
      callServerTool: vi.fn(),
      getHostContext: () => ({ toolInfo: { tool: { name: 'search_knowledge' } } }),
    }
    const promise = waitForInitialToolResult(app, { timeoutMs: 1000 })
    await Promise.resolve()

    app.ontoolresult?.({
      structuredContent: {
        view: 'paywall',
        productRef: 'prd_7TGKZI27',
        returnUrl: 'https://example.test/r',
      },
    })

    const outcome = await promise
    expect(outcome.timedOut).toBe(false)
    if (outcome.timedOut) return
    expect(outcome.bootstrap.productRef).toBe('prd_7TGKZI27')
  })

  it('rejects when the notification is malformed (missing productRef)', async () => {
    const { app, fire } = mkEventfulApp('search_knowledge')
    const promise = waitForInitialToolResult(app, { timeoutMs: 1000 })
    await Promise.resolve()

    fire({
      structuredContent: { view: 'paywall', returnUrl: 'https://example.test/r' },
    })

    await expect(promise).rejects.toThrow(/productRef/)
  })
})

