import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { McpApp, type McpAppFull } from '../McpApp'

function makeApp(opts: {
  toolName?: string
  structuredContent?: unknown
  isError?: boolean
  text?: string
  connectFails?: boolean
  requestTeardown?: () => void | Promise<void>
  hostName?: string | null
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
    getHostVersion:
      opts.hostName === undefined
        ? undefined
        : () => (opts.hostName == null ? undefined : { name: opts.hostName }),
    onhostcontextchanged: undefined,
    onteardown: undefined,
    requestTeardown: opts.requestTeardown ?? vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('<McpApp>', () => {
  it('shows a loading card after `connect()` resolves, while bootstrap is in-flight', async () => {
    // The loading card appears while `fetchMcpBootstrap` is in flight.
    // Data-tool iframe entries no longer exist (payable merchant
    // tools don't advertise `_meta.ui.resourceUri`), so the shell
    // always fires `fetchMcpBootstrap` and the loading card is
    // always legitimate user feedback.
    let resolveCall: (value: unknown) => void = () => {}
    const app = {
      callServerTool: vi.fn(
        () =>
          new Promise((r) => {
            resolveCall = r
          }),
      ),
      getHostContext: () => undefined,
      connect: vi.fn().mockResolvedValue(undefined),
      onhostcontextchanged: undefined,
      onteardown: undefined,
      requestTeardown: vi.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
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

describe('<McpApp> merchant icon head tags', () => {
  const ICON_URL = 'https://cdn.example.test/icon.png'
  const FAVICON_SELECTOR = 'link[data-solvapay-favicon]'
  const PRELOAD_SELECTOR = 'link[data-solvapay-icon-preload]'

  // Head-tag state is global (`document.head`); scrub between tests so
  // a previous case's favicon / preload can't leak into the next.
  afterEach(() => {
    document.head
      .querySelectorAll(`${FAVICON_SELECTOR}, ${PRELOAD_SELECTOR}`)
      .forEach((el) => el.remove())
  })

  function makeIconApp(hostName: string | null | undefined): McpAppFull {
    return makeApp({
      toolName: 'manage_account',
      hostName,
      structuredContent: {
        productRef: 'prod_1',
        returnUrl: 'https://example.test/r',
        customer: { ref: 'cus_1' },
        merchant: { displayName: 'Example', iconUrl: ICON_URL },
      },
    })
  }

  function AccountStub() {
    return <div data-testid="account-stub" />
  }

  it('inserts both favicon and preload on hosts that render AppHeader (MCP Jam)', async () => {
    const app = makeIconApp('MCP Jam')
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')

    const favicon = document.head.querySelector<HTMLLinkElement>(FAVICON_SELECTOR)
    const preload = document.head.querySelector<HTMLLinkElement>(PRELOAD_SELECTOR)
    expect(favicon?.rel).toBe('icon')
    expect(favicon?.href).toBe(ICON_URL)
    expect(preload?.rel).toBe('preload')
    expect(preload?.as).toBe('image')
    expect(preload?.href).toBe(ICON_URL)
  })

  it('inserts both tags when hostName is unknown (safe fallback — matches AppHeader render-time behaviour)', async () => {
    // `getHostVersion` undefined → hostName stays null; AppHeader
    // renders, so the preload has a consumer.
    const app = makeIconApp(undefined)
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')

    expect(document.head.querySelector(FAVICON_SELECTOR)).not.toBeNull()
    expect(document.head.querySelector(PRELOAD_SELECTOR)).not.toBeNull()
  })

  it('omits the preload on Claude Desktop (host paints its own merchant chrome)', async () => {
    const app = makeIconApp('Claude Desktop')
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')

    expect(document.head.querySelector(FAVICON_SELECTOR)).not.toBeNull()
    expect(document.head.querySelector(PRELOAD_SELECTOR)).toBeNull()
  })

  it('omits the preload on ChatGPT', async () => {
    const app = makeIconApp('ChatGPT')
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')

    expect(document.head.querySelector(FAVICON_SELECTOR)).not.toBeNull()
    expect(document.head.querySelector(PRELOAD_SELECTOR)).toBeNull()
  })

  it('removes a stale preload when the app handshake flips to a chrome host', async () => {
    // Pre-seed the head as if a prior mount inserted the preload tag
    // (simulates the handshake-after-bootstrap race: iconUrl committed
    // before hostName resolved to `Claude Desktop`). The effect's
    // hostName-aware branch should strip it on re-run.
    const stale = document.createElement('link')
    stale.setAttribute('data-solvapay-icon-preload', '')
    stale.rel = 'preload'
    stale.as = 'image'
    stale.href = ICON_URL
    document.head.appendChild(stale)

    const app = makeIconApp('Claude Desktop')
    render(<McpApp app={app} views={{ account: AccountStub }} />)
    await screen.findByTestId('account-stub')

    await waitFor(() => {
      expect(document.head.querySelector(PRELOAD_SELECTOR)).toBeNull()
    })
    expect(document.head.querySelector(FAVICON_SELECTOR)).not.toBeNull()
  })
})
