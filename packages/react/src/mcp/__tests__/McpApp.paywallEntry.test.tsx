/**
 * Data-tool iframe entry — paywall.
 *
 * When the host opens the widget in response to a *merchant-registered*
 * paywalled tool (e.g. `search_knowledge`) returning
 * `_meta.ui.resourceUri` on its gate response, `<McpApp>` must consume
 * the originating tool-result notification and render the paywall
 * surface — *not* re-call the merchant tool (which would consume
 * another unit of usage) and *not* discard the gate payload.
 *
 * Companion to `McpApp.nudgeEntry.test.tsx`.
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
  callServerTool: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  fireToolResult: (params: Parameters<ToolResultHandler>[0]) => void
}

/**
 * The refresh path (`McpAppShell` mount-effect → `refreshBootstrap` →
 * `fetchMcpBootstrap` → `callServerTool('upgrade')`) is legitimate for
 * a data-tool iframe entry: it fetches a fresh intent snapshot without
 * re-running the merchant tool. The mock returns a benign structured
 * payload for `upgrade` and throws loudly for any *other* tool name so
 * a regression (re-calling the merchant tool) shows up as a test
 * failure.
 */
function makeDataToolEntryApp(opts: {
  toolName: string
  requestTeardown?: () => void | Promise<void>
}): TestApp {
  const listeners: Record<string, ToolResultHandler[]> = {}
  const hostContext = { toolInfo: { tool: { name: opts.toolName } } }

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

  const requestTeardown = opts.requestTeardown ?? vi.fn().mockResolvedValue(undefined)

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
    requestTeardown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  const fireToolResult: TestApp['fireToolResult'] = (params) => {
    const bucket = listeners['toolresult'] ?? []
    for (const h of bucket) h(params)
  }

  return { app, callServerTool, addEventListener, fireToolResult }
}

/**
 * Flush microtasks until the mount effect has registered its
 * `toolresult` listener. Avoids the race where `fireToolResult` runs
 * before the async effect-body has reached `addEventListener`.
 */
async function waitForSubscription(
  addEventListener: ReturnType<typeof vi.fn>,
): Promise<void> {
  await waitFor(() => {
    expect(
      addEventListener.mock.calls.some((c) => c[0] === 'toolresult'),
    ).toBe(true)
  })
}

describe('<McpApp> — paywall via data-tool iframe entry', () => {
  it('renders the paywall surface from the originating tool-result notification', async () => {
    const { app, callServerTool, addEventListener, fireToolResult } =
      makeDataToolEntryApp({
        toolName: 'search_knowledge',
      })

    const PaywallStub = vi.fn(() => <div data-testid="paywall-stub">paywall</div>)
    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)

    render(
      <McpApp app={app} views={{ paywall: PaywallStub, checkout: CheckoutStub }} />,
    )

    expect(screen.getByText('Loading…')).toBeTruthy()

    await waitForSubscription(addEventListener)

    await act(async () => {
      fireToolResult({
        structuredContent: {
          view: 'paywall',
          productRef: 'prd_7TGKZI27',
          stripePublishableKey: 'pk_test_abc',
          returnUrl: 'https://example.test/r',
          merchant: { displayName: 'Acme' },
          product: { reference: 'prd_7TGKZI27', name: 'Knowledge API' },
          plans: [
            { reference: 'pln_usage', planType: 'usage-based' },
            { reference: 'pln_rec', planType: 'recurring', price: 1000, currency: 'usd' },
          ],
          customer: { ref: 'cus_7' },
          paywall: {
            kind: 'payment_required',
            product: 'prd_7TGKZI27',
            checkoutUrl: 'https://example.test/checkout',
            message: 'Purchase required. Remaining: 0',
          },
        },
        _meta: { ui: { resourceUri: 'ui://mcp-checkout-app/mcp-app.html' } },
        isError: true,
      })
    })

    await screen.findByTestId('paywall-stub')
    expect(PaywallStub).toHaveBeenCalled()
    expect(CheckoutStub).not.toHaveBeenCalled()

    // The merchant tool (`search_knowledge`) must never be re-called —
    // the shell's mount-refresh path is allowed to call `upgrade` for a
    // fresh intent snapshot.
    const calledNames = callServerTool.mock.calls.map((c) => (c[0] as { name: string }).name)
    expect(calledNames).not.toContain('search_knowledge')
  })

  it('forwards paywall content and upgrade plan candidates to <McpPaywallView>', async () => {
    const { app, addEventListener, fireToolResult } = makeDataToolEntryApp({
      toolName: 'search_knowledge',
    })

    const PaywallStub = vi.fn(() => <div data-testid="paywall-stub">paywall</div>)

    render(<McpApp app={app} views={{ paywall: PaywallStub }} />)
    await waitForSubscription(addEventListener)

    await act(async () => {
      fireToolResult({
        structuredContent: {
          view: 'paywall',
          productRef: 'prd_7TGKZI27',
          stripePublishableKey: 'pk_test_abc',
          returnUrl: 'https://example.test/r',
          merchant: { displayName: 'Acme' },
          product: { reference: 'prd_7TGKZI27' },
          plans: [
            {
              reference: 'pln_rec',
              planType: 'recurring',
              price: 1000,
              currency: 'usd',
              name: 'Pro',
              billingCycle: 'month',
            },
          ],
          customer: { ref: 'cus_7' },
          paywall: {
            kind: 'payment_required',
            product: 'prd_7TGKZI27',
            message: 'Purchase required. Remaining: 0',
          },
        },
      })
    })

    await screen.findByTestId('paywall-stub')

    const firstCall = PaywallStub.mock.calls[0] as unknown as [
      {
        content: { kind: string; message?: string }
        upgradeCta?: { label: string }
        publishableKey: string | null
        returnUrl: string
      },
    ]
    expect(firstCall[0].content).toMatchObject({
      kind: 'payment_required',
      message: 'Purchase required. Remaining: 0',
    })
    expect(firstCall[0].publishableKey).toBe('pk_test_abc')
    expect(firstCall[0].returnUrl).toBe('https://example.test/r')
    // `McpAppShell.formatUpgradeLabel` picks the recurring plan when one
    // exists — make sure the bootstrap plumbed through.
    expect(firstCall[0].upgradeCta?.label).toContain('Pro')
  })

  it('silently tears down when the host does not deliver a tool result in time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onInitError = vi.fn()
    const requestTeardown = vi.fn().mockResolvedValue(undefined)
    try {
      const { app } = makeDataToolEntryApp({
        toolName: 'search_knowledge',
        requestTeardown,
      })

      render(<McpApp app={app} onInitError={onInitError} />)

      await act(async () => {
        // Let the mount effect register the listener and enter the
        // data-tool wait, then trip the 2s timeout.
        await vi.advanceTimersByTimeAsync(2500)
      })

      await waitFor(() => {
        expect(requestTeardown).toHaveBeenCalledTimes(1)
      })
      // Not a failure — MCP Apps hosts open the registered UI
      // resource for every tool call on the server regardless of
      // per-tool `_meta.ui`. When no bootstrap payload arrives the
      // iframe simply unmounts itself so the user sees the host's
      // own rendering of the tool result instead of an error card.
      expect(onInitError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
