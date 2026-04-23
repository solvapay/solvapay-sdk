import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { McpApp, type McpAppFull } from '../McpApp'

function makeApp(opts: {
  toolName?: string
  structuredContent?: unknown
  isError?: boolean
  text?: string
  connectFails?: boolean
  requestTeardown?: () => void | Promise<void>
}): McpAppFull {
  return {
    callServerTool: vi.fn().mockResolvedValue({
      isError: opts.isError,
      structuredContent: opts.structuredContent,
      content: opts.text ? [{ type: 'text', text: opts.text }] : undefined,
    }),
    getHostContext: () =>
      opts.toolName ? { toolInfo: { tool: { name: opts.toolName } } } : undefined,
    connect: opts.connectFails
      ? vi.fn().mockRejectedValue(new Error('connect failed'))
      : vi.fn().mockResolvedValue(undefined),
    onhostcontextchanged: undefined,
    onteardown: undefined,
    requestTeardown: opts.requestTeardown ?? vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('<McpApp>', () => {
  it('shows a loading card until bootstrap resolves', () => {
    const app = makeApp({
      structuredContent: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
      },
    })
    render(<McpApp app={app} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('routes to the account view when the host invokes manage_account', async () => {
    const app = makeApp({
      toolName: 'manage_account',
      structuredContent: {
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
    await waitFor(() => {
      expect(screen.getByText('customer_ref missing')).toBeTruthy()
    })
    expect(onInitError.mock.calls[0][0].message).toBe('customer_ref missing')
  })

  it('routes to the nudge view when bootstrap carries view: "nudge"', async () => {
    const app = makeApp({
      // Any tool name; the structured content view field forces the
      // resolution to `nudge` via `requestedView = structured.view ?? view`.
      toolName: 'manage_account',
      structuredContent: {
        view: 'nudge',
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        nudge: { kind: 'low-balance', message: 'credits running low' },
        data: { rows: [1, 2, 3] },
      },
    })
    const NudgeStub = vi.fn(() => <div data-testid="nudge-stub">stubbed nudge</div>)
    render(<McpApp app={app} views={{ nudge: NudgeStub }} />)
    await screen.findByTestId('nudge-stub')
    expect(NudgeStub).toHaveBeenCalled()
    const firstCall = NudgeStub.mock.calls[0] as unknown as [
      { bootstrap: { view: string; nudge?: { kind: string }; data?: unknown } },
    ]
    expect(firstCall[0].bootstrap.view).toBe('nudge')
    expect(firstCall[0].bootstrap.nudge).toEqual({
      kind: 'low-balance',
      message: 'credits running low',
    })
    expect(firstCall[0].bootstrap.data).toEqual({ rows: [1, 2, 3] })
  })

  it('default onClose routes to app.requestTeardown', async () => {
    const requestTeardown = vi.fn().mockResolvedValue(undefined)
    const app = makeApp({
      toolName: 'upgrade',
      structuredContent: {
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
    render(
      <McpApp app={app} onClose={onClose} views={{ checkout: CheckoutStub }} />,
    )
    const closeBtn = await screen.findByTestId('checkout-close')
    closeBtn.click()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(requestTeardown).not.toHaveBeenCalled()
  })

  it('passes classNames through to overridden views', async () => {
    const app = makeApp({
      toolName: 'manage_account',
      structuredContent: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
      },
    })
    const received: Array<{ classNames?: { card?: string } }> = []
    const AccountStub = (props: { classNames?: { card?: string } }) => {
      received.push(props)
      return <div data-testid="account-stub" />
    }
    render(
      <McpApp
        app={app}
        views={{ account: AccountStub }}
        classNames={{ card: 'my-card' }}
      />,
    )
    await screen.findByTestId('account-stub')
    expect(received[0]?.classNames?.card).toBe('my-card')
  })
})
