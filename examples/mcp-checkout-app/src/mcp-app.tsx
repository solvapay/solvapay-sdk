import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'
import { SolvaPayProvider, usePurchase, usePurchaseStatus } from '@solvapay/react'
import '@solvapay/react/styles.css'
import { createMcpAdapter } from './mcp-adapter'
import './mcp-app.css'

const app = new App({ name: 'SolvaPay checkout', version: '1.0.0' })
const adapter = createMcpAdapter(app)

// Keep polling fast enough that the UI feels responsive after the user
// completes payment in the other tab, but not so fast that we hammer the MCP
// server if the user wanders off. Backs off to focus-only once awaitingMs is
// exceeded (defined below).
const POLL_INTERVAL_MS = 3_000
const AWAITING_TIMEOUT_MS = 10 * 60 * 1000

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)

  const root = document.getElementById('root')
  const insets = ctx.safeAreaInsets
  if (insets && root) {
    root.style.paddingTop = `${16 + insets.top}px`
    root.style.paddingRight = `${16 + insets.right}px`
    root.style.paddingBottom = `${16 + insets.bottom}px`
    root.style.paddingLeft = `${16 + insets.left}px`
  }
}

type AsyncUrlState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; href: string }
  | { status: 'error'; message: string }

function useHostedUrl(
  enabled: boolean,
  fetcher: () => Promise<{ href: string }>,
  label: string,
): AsyncUrlState {
  const [state, setState] = useState<AsyncUrlState>({ status: 'idle' })

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })

    fetcher()
      .then(({ href }) => {
        if (cancelled) return
        setState({ status: 'ready', href })
      })
      .catch(err => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : `Failed to load ${label}`
        setState({ status: 'error', message })
      })

    return () => {
      cancelled = true
    }
  }, [enabled, fetcher, label])

  return state
}

type AwaitingState = {
  baselineActiveRef: string | null
  baselineHadPaidPurchase: boolean
  startedAt: number
  href: string
}

type HostedLinkButtonProps = {
  state: AsyncUrlState
  loadingLabel: string
  readyLabel: string
  onLaunch?: (href: string) => void
}

function HostedLinkButton({ state, loadingLabel, readyLabel, onLaunch }: HostedLinkButtonProps) {
  if (state.status === 'ready') {
    return (
      <a
        className="hosted-link"
        href={state.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onLaunch?.(state.href)}
      >
        <button type="button" className="hosted-button">
          {readyLabel}
        </button>
      </a>
    )
  }

  return (
    <button type="button" className="hosted-button" disabled>
      {state.status === 'error' ? 'Unavailable' : loadingLabel}
    </button>
  )
}

function Spinner() {
  return <span className="checkout-spinner" aria-hidden="true" />
}

type AwaitingCardProps = {
  awaiting: AwaitingState
  timedOut: boolean
  onReopen: () => void
  onCancel: () => void
}

function AwaitingCard({ awaiting, timedOut, onReopen, onCancel }: AwaitingCardProps) {
  return (
    <div className="checkout-card">
      <div className="checkout-awaiting-header">
        <Spinner />
        <h2>{timedOut ? 'Still waiting for payment' : 'Waiting for payment…'}</h2>
      </div>
      <p className="checkout-muted">
        {timedOut
          ? "We haven't seen your purchase yet. If you completed payment, give it another moment — otherwise reopen checkout or cancel."
          : 'Complete payment in the other tab. Your purchase will show up here automatically.'}
      </p>
      <a
        className="hosted-link"
        href={awaiting.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onReopen()}
      >
        <button type="button" className="hosted-button">
          Reopen checkout
        </button>
      </a>
      <button type="button" className="checkout-link-button" onClick={onCancel}>
        Didn't complete? Cancel
      </button>
    </div>
  )
}

function CheckoutBody({ productRef }: { productRef: string }) {
  const { loading, refetch, hasPaidPurchase, activePurchase } = usePurchase()
  const { cancelledPurchase, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } =
    usePurchaseStatus()

  const [awaiting, setAwaiting] = useState<AwaitingState | null>(null)
  const [awaitingTimedOut, setAwaitingTimedOut] = useState(false)

  const fetchCheckoutUrl = useCallback(async () => {
    const { checkoutUrl } = await adapter.createCheckoutSession({ productRef })
    return { href: checkoutUrl }
  }, [productRef])

  const fetchCustomerUrl = useCallback(async () => {
    const { customerUrl } = await adapter.createCustomerSession()
    return { href: customerUrl }
  }, [])

  const checkout = useHostedUrl(!loading, fetchCheckoutUrl, 'checkout session')
  const customer = useHostedUrl(!loading && hasPaidPurchase, fetchCustomerUrl, 'customer portal')

  const safeRefetch = useCallback(() => {
    refetch().catch(err => {
      console.warn('[mcp-checkout-ui] refetch failed', err)
    })
  }, [refetch])

  // Refetch purchase when the iframe regains focus so the card reflects a
  // purchase completed in the external hosted-checkout tab.
  useEffect(() => {
    const onFocus = () => safeRefetch()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') safeRefetch()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [safeRefetch])

  // While awaiting a checkout completion, poll `check_purchase` so the card
  // flips automatically even if the user never returns focus to this iframe
  // (e.g. they leave the payment tab open alongside).
  useEffect(() => {
    if (!awaiting) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      safeRefetch()
    }, POLL_INTERVAL_MS)
    const timeout = window.setTimeout(() => {
      setAwaitingTimedOut(true)
    }, AWAITING_TIMEOUT_MS)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [awaiting, safeRefetch])

  // Clear `awaiting` the moment `check_purchase` reports a new paid purchase.
  // The underlying card then auto-transitions to the Manage state.
  useEffect(() => {
    if (!awaiting) return
    if (!hasPaidPurchase) return
    const newRef = activePurchase?.reference ?? null
    const isNewPurchase =
      !awaiting.baselineHadPaidPurchase || newRef !== awaiting.baselineActiveRef
    if (isNewPurchase) {
      setAwaiting(null)
      setAwaitingTimedOut(false)
    }
  }, [awaiting, hasPaidPurchase, activePurchase?.reference])

  const beginAwaiting = useCallback(
    (href: string) => {
      setAwaiting({
        baselineActiveRef: activePurchase?.reference ?? null,
        baselineHadPaidPurchase: hasPaidPurchase,
        startedAt: Date.now(),
        href,
      })
      setAwaitingTimedOut(false)
    },
    [activePurchase?.reference, hasPaidPurchase],
  )

  const cancelAwaiting = useCallback(() => {
    setAwaiting(null)
    setAwaitingTimedOut(false)
  }, [])

  if (loading) {
    return (
      <div className="checkout-card">
        <p>Loading purchase…</p>
      </div>
    )
  }

  if (awaiting) {
    return (
      <AwaitingCard
        awaiting={awaiting}
        timedOut={awaitingTimedOut}
        onReopen={() => setAwaitingTimedOut(false)}
        onCancel={cancelAwaiting}
      />
    )
  }

  if (hasPaidPurchase && activePurchase) {
    return (
      <div className="checkout-card">
        <h2>You're on the {activePurchase.productName} plan</h2>
        <p className="checkout-muted">
          Manage billing, switch plans, or cancel in the SolvaPay portal.
        </p>
        <HostedLinkButton
          state={customer}
          loadingLabel="Loading portal…"
          readyLabel="Manage purchase"
        />
        {customer.status === 'error' && (
          <p className="checkout-error" role="alert">
            {customer.message}
          </p>
        )}
      </div>
    )
  }

  if (shouldShowCancelledNotice && cancelledPurchase) {
    const daysLeft = cancelledPurchase.endDate
      ? getDaysUntilExpiration(cancelledPurchase.endDate)
      : null
    return (
      <div className="checkout-card">
        <h2>Your {cancelledPurchase.productName} purchase is cancelled</h2>
        {cancelledPurchase.endDate ? (
          <div className="checkout-notice">
            <p>
              <strong>Access expires {formatDate(cancelledPurchase.endDate)}</strong>
            </p>
            {daysLeft !== null && daysLeft > 0 && (
              <p className="checkout-muted">
                {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
              </p>
            )}
          </div>
        ) : (
          <p className="checkout-muted">Your purchase access has ended.</p>
        )}
        <HostedLinkButton
          state={checkout}
          loadingLabel="Loading checkout…"
          readyLabel="Purchase again"
          onLaunch={beginAwaiting}
        />
        {checkout.status === 'error' && (
          <p className="checkout-error" role="alert">
            {checkout.message}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="checkout-card">
      <h2>Upgrade your plan</h2>
      <p className="checkout-muted">
        The SolvaPay checkout opens in a new tab. Return here after payment and your purchase will
        show up automatically.
      </p>
      <HostedLinkButton
        state={checkout}
        loadingLabel="Loading checkout…"
        readyLabel="Upgrade"
        onLaunch={beginAwaiting}
      />
      {checkout.status === 'error' && (
        <p className="checkout-error" role="alert">
          {checkout.message}
        </p>
      )}
    </div>
  )
}

// `SolvaPayProvider` short-circuits its fetch pipeline when there's no auth
// token, which means our `checkPurchase` override would never run. In the
// MCP App the real identity lives server-side on the OAuth bridge's
// `customer_ref`, so we just need to tell the provider "yes, you're
// authenticated". Returning a sentinel token is enough to flip
// `isAuthenticated` true and unlock the refetch path.
const mcpAuthAdapter = {
  getToken: async () => 'mcp-session',
  getUserId: async () => null,
}

function CheckoutApp({ productRef }: { productRef: string }) {
  const providerConfig = useMemo(() => ({ auth: { adapter: mcpAuthAdapter } }), [])

  return (
    <SolvaPayProvider config={providerConfig} checkPurchase={adapter.checkPurchase}>
      <main className="main">
        <header className="header">
          <h1>SolvaPay</h1>
        </header>
        <CheckoutBody productRef={productRef} />
      </main>
    </SolvaPayProvider>
  )
}

function Bootstrap() {
  const [ready, setReady] = useState(false)
  const [productRef, setProductRef] = useState<string | null>(null)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const onError = (e: ErrorEvent) => {
      console.error('[mcp-checkout-ui] window.onerror', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error,
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error('[mcp-checkout-ui] unhandledrejection', e.reason)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    app.onhostcontextchanged = ctx => {
      applyContext(ctx)
    }

    app.onteardown = async () => ({})

    ;(async () => {
      try {
        await app.connect()
        applyContext(app.getHostContext())

        const result = await app.callServerTool({ name: 'open_checkout', arguments: {} })
        const structured = result.structuredContent as { productRef?: string } | undefined
        const ref = structured?.productRef
        if (!ref) throw new Error('Server did not return a productRef')
        if (!cancelled) {
          setProductRef(ref)
          setReady(true)
        }
      } catch (err) {
        if (!cancelled) {
          setInitError(err instanceof Error ? err.message : 'Failed to initialize checkout')
        }
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (initError) {
    return (
      <main className="main">
        <div className="checkout-card checkout-error">
          <h2>Unable to load checkout</h2>
          <p>{initError}</p>
        </div>
      </main>
    )
  }

  if (!ready || !productRef) {
    return (
      <main className="main">
        <div className="checkout-card">
          <p>Loading checkout…</p>
        </div>
      </main>
    )
  }

  return <CheckoutApp productRef={productRef} />
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element missing from mcp-app.html')
}
createRoot(rootEl).render(<Bootstrap />)
