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
    // Shell renders the "My account" identity heading (below the logo).
    expect(screen.getByText('My account')).toBeTruthy()
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
