import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { McpApp, type McpAppFull } from '../McpApp'

beforeEach(() => {
  vi.useRealTimers()
})

type ToolResultHandler = (params: {
  structuredContent?: unknown
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
}) => void

function makeApp(opts: {
  toolName?: string
  structuredContent?: unknown
  isError?: boolean
  text?: string
  connectFails?: boolean
  requestTeardown?: () => void | Promise<void>
  /** When false, simulates a host that never pushes the opening notification. */
  emitInitialToolResult?: boolean
}): McpAppFull {
  const listeners: Record<string, ToolResultHandler[]> = {}
  const emitInitialToolResult = opts.emitInitialToolResult ?? true

  const fireToolResult: ToolResultHandler = (params) => {
    for (const handler of listeners['toolresult'] ?? []) handler(params)
    app.ontoolresult?.(params)
  }

  const app: McpAppFull = {
    callServerTool: vi.fn().mockResolvedValue({
      isError: opts.isError,
      structuredContent: opts.structuredContent,
      content: opts.text ? [{ type: 'text', text: opts.text }] : undefined,
    }),
    getHostContext: () =>
      opts.toolName ? { toolInfo: { tool: { name: opts.toolName } } } : undefined,
    connect: opts.connectFails
      ? vi.fn().mockRejectedValue(new Error('connect failed'))
      : vi.fn().mockImplementation(async () => {
          await Promise.resolve()
          if (
            emitInitialToolResult &&
            opts.structuredContent !== undefined &&
            !opts.isError
          ) {
            fireToolResult({ structuredContent: opts.structuredContent })
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
    requestTeardown: opts.requestTeardown ?? vi.fn().mockResolvedValue(undefined),
    ontoolresult: undefined,
  }

  return app
}

describe('<McpApp>', () => {
  it('shows a loading card after `connect()` resolves, while bootstrap is in-flight', async () => {
    // The loading card appears while the opening notification wait or
    // `fetchMcpBootstrap` fallback is in flight.
    let resolveCall: (value: unknown) => void = () => {}
    const app = makeApp({
      emitInitialToolResult: false,
      structuredContent: undefined,
    })
    app.callServerTool = vi.fn(
      () =>
        new Promise((r) => {
          resolveCall = r
        }),
    )
    try {
      render(<McpApp app={app} />)
      await waitFor(() => {
        expect(screen.getByText('Loading…')).toBeTruthy()
      })
    } finally {
      resolveCall({
        structuredContent: {
          productRef: 'prod_1',
          returnUrl: 'https://example.test/r',
        },
      })
    }
  })

  it('does not re-call the intent tool when the host pushes the opening notification', async () => {
    const app = makeApp({
      toolName: 'manage_account',
      structuredContent: {
        view: 'account',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })
    const AccountStub = vi.fn(() => <div data-testid="account-stub">stubbed account</div>)
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')
    expect(app.callServerTool).not.toHaveBeenCalled()
  })

  it('routes to the account view when the host invokes manage_account', async () => {
    const app = makeApp({
      toolName: 'manage_account',
      structuredContent: {
        view: 'account',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })
    const AccountStub = vi.fn(() => <div data-testid="account-stub">stubbed account</div>)
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')
    expect(AccountStub).toHaveBeenCalled()
  })

  it('routes to the topup view when the host invokes topup', async () => {
    const app = makeApp({
      toolName: 'topup',
      structuredContent: {
        view: 'topup',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
        // Usage-based plan present so the shell's visibility rule keeps
        // the Top up tab in the strip.
        plans: [{ reference: 'pln_ub', planType: 'usage-based' }],
      },
    })
    const TopupStub = vi.fn(() => <div data-testid="topup-stub">stubbed topup</div>)
    render(<McpApp app={app} views={{ topup: TopupStub }} />)
    await screen.findByTestId('topup-stub')
  })

  it('renders the init-error card and calls onInitError when bootstrap fails', async () => {
    const app = makeApp({ connectFails: true })
    const onInitError = vi.fn()
    render(<McpApp app={app} onInitError={onInitError} />)
    await waitFor(() => {
      expect(screen.getByText('Unable to load SolvaPay')).toBeTruthy()
    })
    expect(screen.getByText('connect failed')).toBeTruthy()
    expect(onInitError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('surfaces tool errors via onInitError', async () => {
    const app = makeApp({
      isError: true,
      text: 'customer_ref missing',
    })
    const onInitError = vi.fn()
    render(<McpApp app={app} onInitError={onInitError} />)
    await waitFor(
      () => {
        expect(screen.getByText('customer_ref missing')).toBeTruthy()
      },
      { timeout: 5000 },
    )
    expect(onInitError.mock.calls[0][0].message).toBe('customer_ref missing')
  })

  it('default onClose routes to app.requestTeardown', async () => {
    const requestTeardown = vi.fn().mockResolvedValue(undefined)
    const app = makeApp({
      toolName: 'upgrade',
      structuredContent: {
        view: 'checkout',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
      requestTeardown,
    })
    const received: Array<{ onClose?: () => void }> = []
    const CheckoutStub = (props: { onClose?: () => void }) => {
      received.push(props)
      return (
        <button type="button" data-testid="checkout-close" onClick={props.onClose}>
          close
        </button>
      )
    }
    render(<McpApp app={app} views={{ checkout: CheckoutStub }} />)
    const closeBtn = await screen.findByTestId('checkout-close')
    await waitFor(() => {
      expect(received[0]?.onClose).toBeTypeOf('function')
    })
    closeBtn.click()
    await waitFor(() => {
      expect(requestTeardown).toHaveBeenCalledTimes(1)
    })
  })

  it('accepts an `onClose` override that replaces the default teardown', async () => {
    const requestTeardown = vi.fn().mockResolvedValue(undefined)
    const app = makeApp({
      toolName: 'upgrade',
      structuredContent: {
        view: 'checkout',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
      requestTeardown,
    })
    const onClose = vi.fn()
    const CheckoutStub = (props: { onClose?: () => void }) => (
      <button type="button" data-testid="checkout-close" onClick={props.onClose}>
        close
      </button>
    )
    render(<McpApp app={app} views={{ checkout: CheckoutStub }} onClose={onClose} />)
    const closeBtn = await screen.findByTestId('checkout-close')
    closeBtn.click()
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(requestTeardown).not.toHaveBeenCalled()
  })
})
