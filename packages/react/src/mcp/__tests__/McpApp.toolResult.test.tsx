/**
 * Phase 3 — live `ui/notifications/tool-result` re-routing.
 *
 * When a host re-invokes the `account` viewer against an already-mounted
 * `App` fires a `toolresult` notification with fresh `structuredContent`.
 * `<McpApp>` must pick that up and swap the rendered surface without
 * waiting for an iframe remount.
 */

import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpApp, OPENING_RESULT_GRACE_MS, type McpAppFull } from '../McpApp'
import { VIEWER_TOOL_NAME } from '@solvapay/mcp-core'

beforeEach(() => {
  vi.useRealTimers()
})

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
  fireToolInput: () => void
  fireToolCancelled: () => void
  resolveResource: (payload?: unknown) => void
}

const BOOTSTRAP_BASE = {
  productRef: 'prod_1',
  returnUrl: 'https://example.test/r',
  customer: { ref: 'cus_1' },
}

function makeEventfulApp(opts: {
  /** `null` means the host opened the iframe with no `toolInfo`. */
  initialToolName?: string | null
  initialStructured: unknown
  /** When false, `connect()` does not fire the opening toolresult. */
  emitOnConnect?: boolean
  resourcePayload?: unknown
  /** When true, `readServerResource` stays pending until `resolveResource`. */
  deferResource?: boolean
}): TestApp {
  const listeners: Record<string, ToolResultHandler[]> = {}
  const hostContext: TestApp['hostContext'] = {
    toolInfo: { tool: { name: opts.initialToolName ?? '' } },
  }
  const resourcePayload = opts.resourcePayload ?? { view: 'account', ...BOOTSTRAP_BASE }
  let resolveResourceFn: (value: { contents: Array<{ text: string }> }) => void = () => {}

  const fire = (evt: string, params?: Parameters<ToolResultHandler>[0]) => {
    const bucket = listeners[evt] ?? []
    for (const h of bucket) h(params ?? {})
  }

  const fireToolResult: TestApp['fireToolResult'] = params => {
    fire('toolresult', params)
  }

  const payloadContents = (payload: unknown) => ({
    contents: [{ text: JSON.stringify(payload) }],
  })

  const app = {
    callServerTool: vi.fn().mockResolvedValue({
      structuredContent: opts.initialStructured,
    }),
    readServerResource: vi.fn().mockImplementation(() =>
      opts.deferResource
        ? new Promise(resolve => {
            resolveResourceFn = resolve
          })
        : Promise.resolve(payloadContents(resourcePayload)),
    ),
    getHostContext: () => (opts.initialToolName == null ? {} : hostContext),
    connect: vi.fn().mockImplementation(async () => {
      await Promise.resolve()
      if (opts.emitOnConnect !== false) {
        fireToolResult({ structuredContent: opts.initialStructured })
      }
    }),
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

  return {
    app,
    hostContext,
    fireToolResult,
    fireToolInput: () => fire('toolinput'),
    fireToolCancelled: () => fire('toolcancelled'),
    resolveResource: (payload?: unknown) => {
      resolveResourceFn(payloadContents(payload ?? resourcePayload))
    },
  }
}

function useOpeningGraceTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

async function flushConnect() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('<McpApp> — live tool-result subscription', () => {
  it('re-routes the rendered surface when a new tool-result notification arrives', async () => {
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: VIEWER_TOOL_NAME,
      initialStructured: {
        view: 'checkout',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">topup</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub, topup: TopupStub }} />)

    // Initial route: checkout from structuredContent.view.
    await screen.findByTestId('checkout-stub')

    // Host re-invokes account with a topup payload against the widget.
    hostContext.toolInfo.tool.name = VIEWER_TOOL_NAME

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
      initialToolName: VIEWER_TOOL_NAME,
      initialStructured: {
        view: 'account',
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
      'create_hosted_session',
      'set_renewal',
      'activate_plan',
      'get_history',
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
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('topup-stub')).toBeNull()
    expect(screen.queryByTestId('account-stub')).toBeTruthy()
  })

  it('does not re-route or tear down on error tool-result notifications post-mount', async () => {
    // Claude Desktop fires a `toolresult` notification for every
    // tool call on the server. Once a checkout/account shell is
    // mounted, a stray `isError` notification from an unrelated
    // host tool re-invocation must not clobber the user's
    // in-flight view — the handler catches the parse failure and
    // leaves the shell alone. `requestTeardown` must NOT fire.
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: VIEWER_TOOL_NAME,
      initialStructured: {
        view: 'checkout',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">topup</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub, topup: TopupStub }} />)
    await screen.findByTestId('checkout-stub')

    hostContext.toolInfo.tool.name = VIEWER_TOOL_NAME

    await act(async () => {
      fireToolResult({
        isError: true,
        content: [{ type: 'text', text: 'something broke' }],
      })
    })

    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('topup-stub')).toBeNull()
    // The mounted checkout shell must survive — the pre-mount
    // teardown guard gates on `bootstrapRef`.
    expect(screen.queryByTestId('checkout-stub')).toBeTruthy()
    expect(app.requestTeardown).not.toHaveBeenCalled()
  })

  it('does not tear down when a non-bootstrap (Oracle-style) notification arrives post-mount', async () => {
    // Companion to the post-mount `isError` test: a stray
    // host-rendered data tool result (Oracle's `predict_direction`
    // etc.) must not dismiss the user's in-flight checkout shell.
    // Without the `bootstrapRef.current === null` guard, every
    // unrelated tool call on the server would tear the widget down.
    const { app, hostContext, fireToolResult } = makeEventfulApp({
      initialToolName: VIEWER_TOOL_NAME,
      initialStructured: {
        view: 'checkout',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })

    const CheckoutStub = vi.fn(() => <div data-testid="checkout-stub">checkout</div>)

    render(<McpApp app={app} views={{ checkout: CheckoutStub }} />)
    await screen.findByTestId('checkout-stub')

    hostContext.toolInfo.tool.name = 'predict_direction'

    await act(async () => {
      fireToolResult({
        structuredContent: { direction: 'up', confidence: 0.8 },
      })
    })

    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByTestId('checkout-stub')).toBeTruthy()
    expect(app.requestTeardown).not.toHaveBeenCalled()
  })

  it('falls back to the legacy `ontoolresult` setter when addEventListener is unavailable', async () => {
    let setHandler: ToolResultHandler | undefined

    const hostContext = { toolInfo: { tool: { name: VIEWER_TOOL_NAME } } }
    const app = {
      callServerTool: vi.fn().mockResolvedValue({
        structuredContent: {
          productRef: 'prod_1',
          returnUrl: 'https://example.test/r',
          customer: { ref: 'cus_1' },
        },
      }),
      getHostContext: () => hostContext,
      connect: vi.fn().mockImplementation(async () => {
        await Promise.resolve()
        setHandler?.({
          structuredContent: {
            view: 'checkout',
            productRef: 'prod_1',
            returnUrl: 'https://example.test/r',
            customer: { ref: 'cus_1' },
          },
        })
      }),
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

    hostContext.toolInfo.tool.name = VIEWER_TOOL_NAME

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

describe('<McpApp> — opening tool result wins over the fallback fetch', () => {
  const CheckoutStub = () => <div data-testid="checkout-stub">checkout</div>
  const AccountStub = () => <div data-testid="account-stub">account</div>
  const views = { checkout: CheckoutStub, account: AccountStub }

  function checkoutPayload() {
    return { view: 'checkout' as const, ...BOOTSTRAP_BASE }
  }

  it('renders the late toolresult view and never reads the resource', async () => {
    useOpeningGraceTimers()
    try {
      const { app, fireToolResult } = makeEventfulApp({
        initialToolName: null,
        initialStructured: { view: 'account', ...BOOTSTRAP_BASE },
        emitOnConnect: false,
        resourcePayload: { view: 'account', ...BOOTSTRAP_BASE },
      })
      render(<McpApp app={app} views={views} />)
      await flushConnect()
      await act(async () => {
        fireToolResult({ structuredContent: checkoutPayload() })
      })
      expect(screen.getByTestId('checkout-stub')).toBeTruthy()
      expect(screen.queryByTestId('account-stub')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPENING_RESULT_GRACE_MS)
      })
      expect(app.readServerResource).not.toHaveBeenCalled()
      expect(screen.queryByTestId('account-stub')).toBeNull()
      expect(screen.getByTestId('checkout-stub')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the grace timer when toolinput arrives, then renders the toolresult', async () => {
    useOpeningGraceTimers()
    try {
      const { app, fireToolInput, fireToolResult } = makeEventfulApp({
        initialToolName: null,
        initialStructured: checkoutPayload(),
        emitOnConnect: false,
      })
      render(<McpApp app={app} views={views} />)
      await flushConnect()
      await act(async () => {
        fireToolInput()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPENING_RESULT_GRACE_MS + 1)
      })
      expect(app.readServerResource).not.toHaveBeenCalled()
      expect(screen.queryByTestId('checkout-stub')).toBeNull()
      await act(async () => {
        fireToolResult({ structuredContent: checkoutPayload() })
      })
      expect(screen.getByTestId('checkout-stub')).toBeTruthy()
      expect(screen.queryByTestId('account-stub')).toBeNull()
      expect(app.readServerResource).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the resource after the grace window when no notification arrives', async () => {
    useOpeningGraceTimers()
    try {
      const { app } = makeEventfulApp({
        initialToolName: null,
        initialStructured: { view: 'account', ...BOOTSTRAP_BASE },
        emitOnConnect: false,
        resourcePayload: { view: 'account', ...BOOTSTRAP_BASE },
      })
      render(<McpApp app={app} views={views} />)
      await flushConnect()
      expect(app.readServerResource).not.toHaveBeenCalled()
      expect(screen.getByText('Loading…')).toBeTruthy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPENING_RESULT_GRACE_MS)
      })
      expect(app.readServerResource).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('account-stub')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards the in-flight resource read when the opening toolresult arrives', async () => {
    useOpeningGraceTimers()
    try {
      const { app, fireToolResult, resolveResource } = makeEventfulApp({
        initialToolName: null,
        initialStructured: checkoutPayload(),
        emitOnConnect: false,
        deferResource: true,
        resourcePayload: { view: 'account', ...BOOTSTRAP_BASE },
      })
      render(<McpApp app={app} views={views} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OPENING_RESULT_GRACE_MS)
      })
      expect(app.readServerResource).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Loading…')).toBeTruthy()
      await act(async () => {
        fireToolResult({ structuredContent: checkoutPayload() })
      })
      expect(screen.getByTestId('checkout-stub')).toBeTruthy()
      await act(async () => {
        resolveResource({ view: 'account', ...BOOTSTRAP_BASE })
        await Promise.resolve()
      })
      expect(screen.getByTestId('checkout-stub')).toBeTruthy()
      expect(screen.queryByTestId('account-stub')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the resource when the opening call is cancelled', async () => {
    useOpeningGraceTimers()
    try {
      const { app, fireToolInput, fireToolCancelled } = makeEventfulApp({
        initialToolName: null,
        initialStructured: { view: 'account', ...BOOTSTRAP_BASE },
        emitOnConnect: false,
        resourcePayload: { view: 'topup', ...BOOTSTRAP_BASE },
      })
      const TopupStub = () => <div data-testid="topup-stub">topup</div>
      render(<McpApp app={app} views={{ ...views, topup: TopupStub }} />)
      await flushConnect()
      await act(async () => {
        fireToolInput()
        fireToolCancelled()
      })
      expect(app.readServerResource).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('topup-stub')).toBeTruthy()
      expect(screen.queryByText('Loading…')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the resource when the opening toolresult is an error', async () => {
    useOpeningGraceTimers()
    try {
      const { app, fireToolResult } = makeEventfulApp({
        initialToolName: null,
        initialStructured: { view: 'account', ...BOOTSTRAP_BASE },
        emitOnConnect: false,
        resourcePayload: { view: 'account', ...BOOTSTRAP_BASE },
      })
      render(<McpApp app={app} views={views} />)
      await flushConnect()
      await act(async () => {
        fireToolResult({
          isError: true,
          content: [{ type: 'text', text: 'customer_ref missing' }],
        })
      })
      expect(app.readServerResource).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('account-stub')).toBeTruthy()
      expect(screen.queryByText('Loading…')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers toolinput, toolinputpartial, and toolcancelled before connect()', async () => {
    const { app } = makeEventfulApp({
      initialToolName: null,
      initialStructured: { view: 'account', ...BOOTSTRAP_BASE },
      emitOnConnect: false,
    })
    const { unmount } = render(<McpApp app={app} views={views} />)
    await act(async () => {
      await Promise.resolve()
    })
    const add = app.addEventListener as ReturnType<typeof vi.fn>
    const connectOrder = (app.connect as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(connectOrder).toBeTypeOf('number')
    for (const evt of ['toolinput', 'toolinputpartial', 'toolcancelled']) {
      const index = add.mock.calls.findIndex(call => call[0] === evt)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(add.mock.invocationCallOrder[index]).toBeLessThan(connectOrder)
    }
    unmount()
    const remove = app.removeEventListener as ReturnType<typeof vi.fn>
    const removed = remove.mock.calls.map(call => call[0])
    for (const evt of ['toolresult', 'toolinput', 'toolinputpartial', 'toolcancelled']) {
      expect(removed).toContain(evt)
    }
  })
})
