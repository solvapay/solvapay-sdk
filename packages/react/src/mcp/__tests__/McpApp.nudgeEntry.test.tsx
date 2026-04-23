/**
 * Data-tool iframe entry — nudge.
 *
 * When a merchant paywalled tool (e.g. `query_sales_trends`) returns a
 * successful result with `ctx.respond(..., { nudge })`, the SolvaPay
 * `buildPayableHandler` stamps `_meta.ui.resourceUri` and rewrites
 * `structuredContent` with `view: 'nudge'` plus the original merchant
 * data on `.data`. `<McpApp>` must consume that notification and
 * render the nudge surface — the merchant tool must not be re-called.
 *
 * Companion to `McpApp.paywallEntry.test.tsx`.
 */

import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { McpApp, type McpAppFull } from '../McpApp'

type ToolResultHandler = (params: {
  structuredContent?: unknown
  content?: unknown
  isError?: boolean
  _meta?: unknown
}) => void

interface TestApp {
  app: McpAppFull
  callServerTool: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  fireToolResult: (params: Parameters<ToolResultHandler>[0]) => void
}

function makeDataToolEntryApp(opts: { toolName: string }): TestApp {
  const listeners: Record<string, ToolResultHandler[]> = {}
  const hostContext = { toolInfo: { tool: { name: opts.toolName } } }

  // `upgrade` (from the shell's mount-refresh) is OK. The merchant
  // tool must never be re-called — throwing here makes the regression
  // visible.
  const callServerTool = vi.fn(async (params: { name: string }) => {
    if (params.name === 'upgrade') {
      return {
        structuredContent: {
          view: 'checkout',
          productRef: 'prd_7TGKZI27',
          stripePublishableKey: 'pk_test_abc',
          returnUrl: 'https://example.test/r',
        },
      }
    }
    throw new Error(
      `callServerTool must not be called with '${params.name}' for a data-tool entry`,
    )
  })

  const addEventListener = vi.fn((evt: string, handler: ToolResultHandler) => {
    ;(listeners[evt] ??= []).push(handler)
  })

  const app = {
    callServerTool,
    getHostContext: () => hostContext,
    connect: vi.fn().mockResolvedValue(undefined),
    addEventListener,
    removeEventListener: vi.fn((evt: string, handler: ToolResultHandler) => {
      const bucket = listeners[evt] ?? []
      const idx = bucket.indexOf(handler)
      if (idx >= 0) bucket.splice(idx, 1)
    }),
    onhostcontextchanged: undefined,
    onteardown: undefined,
    requestTeardown: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  const fireToolResult: TestApp['fireToolResult'] = (params) => {
    const bucket = listeners['toolresult'] ?? []
    for (const h of bucket) h(params)
  }

  return { app, callServerTool, addEventListener, fireToolResult }
}

async function waitForSubscription(
  addEventListener: ReturnType<typeof vi.fn>,
): Promise<void> {
  await waitFor(() => {
    expect(
      addEventListener.mock.calls.some((c) => c[0] === 'toolresult'),
    ).toBe(true)
  })
}

describe('<McpApp> — nudge via data-tool iframe entry', () => {
  it('renders the nudge surface and preserves the merchant data payload', async () => {
    const { app, callServerTool, addEventListener, fireToolResult } =
      makeDataToolEntryApp({
        toolName: 'query_sales_trends',
      })

    const NudgeStub = vi.fn(() => <div data-testid="nudge-stub">nudge</div>)
    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)

    render(<McpApp app={app} views={{ nudge: NudgeStub, checkout: CheckoutStub }} />)

    expect(screen.getByText('Loading…')).toBeTruthy()

    await waitForSubscription(addEventListener)

    const merchantData = {
      range: '7d',
      results: [
        { date: '2026-01-01', units: 12, revenue: 1234 },
        { date: '2026-01-02', units: 15, revenue: 1512 },
      ],
    }

    await act(async () => {
      fireToolResult({
        structuredContent: {
          view: 'nudge',
          productRef: 'prd_7TGKZI27',
          stripePublishableKey: 'pk_test_abc',
          returnUrl: 'https://example.test/r',
          merchant: { displayName: 'Acme' },
          product: { reference: 'prd_7TGKZI27' },
          plans: [{ reference: 'pln_ub', planType: 'usage-based' }],
          customer: { ref: 'cus_7', balance: { amount: 500 } },
          nudge: {
            kind: 'low-balance',
            message: 'Running low on credits — top up to keep querying.',
          },
          data: merchantData,
        },
        _meta: {
          ui: {
            resourceUri: 'ui://mcp-checkout-app/mcp-app.html',
            nudge: {
              kind: 'low-balance',
              message: 'Running low on credits — top up to keep querying.',
            },
          },
        },
      })
    })

    await screen.findByTestId('nudge-stub')
    expect(NudgeStub).toHaveBeenCalled()
    expect(CheckoutStub).not.toHaveBeenCalled()

    const calledNames = callServerTool.mock.calls.map(
      (c) => (c[0] as { name: string }).name,
    )
    expect(calledNames).not.toContain('query_sales_trends')

    const firstCall = NudgeStub.mock.calls[0] as unknown as [
      {
        bootstrap: {
          view: string
          nudge?: { kind: string; message?: string }
          data?: unknown
        }
        onCta?: () => void
      },
    ]
    expect(firstCall[0].bootstrap.view).toBe('nudge')
    expect(firstCall[0].bootstrap.nudge).toEqual({
      kind: 'low-balance',
      message: 'Running low on credits — top up to keep querying.',
    })
    expect(firstCall[0].bootstrap.data).toEqual(merchantData)
    expect(typeof firstCall[0].onCta).toBe('function')
  })

  it('swallows malformed tool-result notifications without clobbering the loading state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { app, addEventListener, fireToolResult } = makeDataToolEntryApp({
        toolName: 'query_sales_trends',
      })

      const NudgeStub = vi.fn(() => <div data-testid="nudge-stub">nudge</div>)
      render(<McpApp app={app} views={{ nudge: NudgeStub }} />)
      await waitForSubscription(addEventListener)

      // Missing productRef — `parseBootstrapFromToolResult` throws,
      // the handler soft-warns and leaves the shell in loading.
      await act(async () => {
        fireToolResult({
          structuredContent: {
            view: 'nudge',
            returnUrl: 'https://example.test/r',
          },
        })
      })

      expect(NudgeStub).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[solvapay]'),
        expect.anything(),
      )

      // A subsequent well-formed notification routes correctly.
      await act(async () => {
        fireToolResult({
          structuredContent: {
            view: 'nudge',
            productRef: 'prd_7TGKZI27',
            returnUrl: 'https://example.test/r',
            nudge: { kind: 'low-balance', message: 'top up' },
            data: { ok: true },
          },
        })
      })

      await screen.findByTestId('nudge-stub')
    } finally {
      warn.mockRestore()
    }
  })
})
