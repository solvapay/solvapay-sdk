/**
 * Phase 3 — live `ui/notifications/tool-result` re-routing.
 *
 * When a host re-invokes one of our intent tools (`upgrade`,
 * `manage_account`, `topup`) against an already-mounted widget, the
 * `App` fires a `toolresult` notification with fresh `structuredContent`.
 * `<McpApp>` must pick that up and swap the rendered surface without
 * waiting for an iframe remount.
 */

import { render, screen, waitFor, act } from '@testing-library/react'
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
  hostContext: { toolInfo: { tool: { name: string } } }
  fireToolResult: (params: Parameters<ToolResultHandler>[0]) => void
}

function makeEventfulApp(opts: {
  initialToolName: string
  initialStructured: unknown
}): TestApp {
  const listeners: Record<string, ToolResultHandler[]> = {}
  const hostContext = { toolInfo: { tool: { name: opts.initialToolName } } }

  const app = {
    callServerTool: vi.fn().mockResolvedValue({
      structuredContent: opts.initialStructured,
    }),
    getHostContext: () => hostContext,
    connect: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((evt: string, handler: ToolResultHandler) => {
      ;(listeners[evt] ??= []).push(handler)
    }),
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

  return { app, hostContext, fireToolResult }
}

describe('<McpApp> — live tool-result subscription', () => {
  it('re-routes the rendered surface when a new tool-result notification arrives', async () => {
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: 'upgrade',
      initialStructured: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">topup</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub, topup: TopupStub }} />)

    // Initial route: checkout (because `upgrade` was the launching tool).
    await screen.findByTestId('checkout-stub')

    // Host re-invokes `topup` against the already-mounted widget.
    // Simulate the host-context update + tool-result notification.
    hostContext.toolInfo.tool.name = 'topup'

    await act(async () => {
      fireToolResult({
        structuredContent: {
          view: 'topup',
          productRef: 'prod_1',
          returnUrl: 'https://example.test/r',
          customer: { ref: 'cus_1' },
          plans: [{ reference: 'pln_ub', planType: 'usage-based' }],
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('topup-stub')).toBeTruthy()
    })
  })

  it('ignores tool-result notifications for transport tools (e.g. create_payment_intent)', async () => {
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: 'manage_account',
      initialStructured: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const AccountStub = vi.fn(() => <div data-testid="account-stub">account</div>)
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">topup</div>)

    render(<McpApp app={app} views={{ account: AccountStub, topup: TopupStub }} />)
    await screen.findByTestId('account-stub')

    // Every SolvaPay transport tool should be filtered by the
    // `SOLVAPAY_TRANSPORT_TOOL_NAMES` denylist — notifications for
    // these resolve via the `callServerTool` adapter promise, and
    // re-applying them would double-apply state.
    const TRANSPORT_TOOLS = [
      'create_payment_intent',
      'process_payment',
      'create_topup_payment_intent',
      'cancel_renewal',
      'reactivate_renewal',
      'activate_plan',
      'create_checkout_session',
      'create_customer_session',
    ]

    for (const transportTool of TRANSPORT_TOOLS) {
      hostContext.toolInfo.tool.name = transportTool
      await act(async () => {
        fireToolResult({
          structuredContent: {
            view: 'topup',
            productRef: 'prod_1',
            returnUrl: 'https://example.test/r',
          },
        })
      })
    }

    // 50ms grace; no re-route should happen for any of them.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('topup-stub')).toBeNull()
    expect(screen.queryByTestId('account-stub')).toBeTruthy()
  })

  it('re-routes when a paywalled merchant tool fires a nudge notification mid-session', async () => {
    // Merchant data tools (not in VIEW_FOR_TOOL, not in the transport
    // denylist) must re-route when their notification carries a
    // recognisable `structuredContent.view`. This is the live-flow
    // analogue of the mount-time data-tool entry path.
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: 'upgrade',
      initialStructured: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)
    const NudgeStub = vi.fn(() => <div data-testid="nudge-stub">nudge</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub, nudge: NudgeStub }} />)
    await screen.findByTestId('checkout-stub')

    hostContext.toolInfo.tool.name = 'query_sales_trends'

    await act(async () => {
      fireToolResult({
        structuredContent: {
          view: 'nudge',
          productRef: 'prod_1',
          returnUrl: 'https://example.test/r',
          customer: { ref: 'cus_1' },
          plans: [{ reference: 'pln_ub', planType: 'usage-based' }],
          nudge: { kind: 'low-balance', message: 'top up' },
          data: { ok: true },
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('nudge-stub')).toBeTruthy()
    })
  })

  it('ignores error tool-result notifications', async () => {
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: 'upgrade',
      initialStructured: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">topup</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub, topup: TopupStub }} />)
    await screen.findByTestId('checkout-stub')

    hostContext.toolInfo.tool.name = 'topup'

    await act(async () => {
      fireToolResult({
        isError: true,
        content: [{ type: 'text', text: 'something broke' }],
      })
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('topup-stub')).toBeNull()
  })

  it('falls back to the legacy `ontoolresult` setter when addEventListener is unavailable', async () => {
    let setHandler: ToolResultHandler | undefined

    const hostContext = { toolInfo: { tool: { name: 'upgrade' } } }
    const app = {
      callServerTool: vi.fn().mockResolvedValue({
        structuredContent: {
          productRef: 'prod_1',
          returnUrl: 'https://example.test/r',
          customer: { ref: 'cus_1' },
        },
      }),
      getHostContext: () => hostContext,
      connect: vi.fn().mockResolvedValue(undefined),
      onhostcontextchanged: undefined,
      onteardown: undefined,
      requestTeardown: vi.fn().mockResolvedValue(undefined),
      // legacy DOM-style setter
      get ontoolresult() {
        return setHandler
      },
      set ontoolresult(h: ToolResultHandler | undefined) {
        setHandler = h
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">topup</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub, topup: TopupStub }} />)
    await screen.findByTestId('checkout-stub')

    hostContext.toolInfo.tool.name = 'topup'

    await act(async () => {
      setHandler?.({
        structuredContent: {
          view: 'topup',
          productRef: 'prod_1',
          returnUrl: 'https://example.test/r',
          customer: { ref: 'cus_1' },
          plans: [{ reference: 'pln_ub', planType: 'usage-based' }],
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('topup-stub')).toBeTruthy()
    })
  })
})
