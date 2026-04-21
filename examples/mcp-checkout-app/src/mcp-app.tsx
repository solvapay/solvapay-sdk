import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'
import { loadStripe } from '@stripe/stripe-js'
import {
  CurrentPlanCard,
  SolvaPayProvider,
  usePurchase,
  usePurchaseStatus,
  useSolvaPay,
} from '@solvapay/react'
import { PaymentForm, PlanSelector, usePlanSelector } from '@solvapay/react/primitives'
import '@solvapay/react/styles.css'
import { createMcpAppAdapter, createMcpFetch, fetchOpenCheckoutProductRef } from './mcp-adapter'
import './mcp-app.css'

const app = new App({ name: 'SolvaPay checkout', version: '1.0.0' })
const transport = createMcpAppAdapter(app)
const mcpFetch = createMcpFetch(transport)

// Keep polling fast enough that the UI feels responsive after the user
// completes payment in the other tab, but not so fast that we hammer the MCP
// server if the user wanders off.
const POLL_INTERVAL_MS = 3_000
const AWAITING_TIMEOUT_MS = 10 * 60 * 1000

// Stripe.js takes ~1-2s to load on a warm cache. 3s is long enough to
// distinguish a slow CDN from a CSP-blocked host without making the user
// stare at a spinner.
const STRIPE_PROBE_TIMEOUT_MS = 3_000

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

type ProbeState = 'loading' | 'ready' | 'blocked'

/**
 * Probe whether `@stripe/stripe-js` can mount inside the current host
 * sandbox. Compliant hosts (basic-host, ChatGPT) honour the declared
 * `_meta.ui.csp.frameDomains` and Stripe loads normally; non-compliant
 * hosts (Claude today — see anthropics/claude-ai-mcp#40) hardcode
 * `frame-src 'self' blob: data:` and the nested card iframe is refused.
 *
 * We race `loadStripe()` against a 3s timeout — in the blocked case
 * Stripe.js either throws a ContentSecurityPolicy error or the promise
 * simply never resolves, and the timeout wins.
 *
 * Note on the key: `publishableKey` is SolvaPay's **platform** Stripe
 * pk (same one the backend returns from `create_payment_intent`). It
 * is used here only to satisfy `loadStripe()`'s validator so we can
 * exercise `frameDomains` — we never feed it into `confirmPayment`.
 * The real payment flow re-fetches the pk (and, crucially, the
 * connected `accountId`) from `create_payment_intent` and boots its
 * own `Stripe` instance via the SDK's `useCheckout`. SolvaPay is a
 * Stripe Connect direct-charge platform, so all browser-side Stripe
 * calls pair the platform pk with `{ stripeAccount: acct_XXX }`; the
 * connected merchant's own publishable key is never involved.
 */
function useStripeProbe(publishableKey: string | null): ProbeState {
  const [state, setState] = useState<ProbeState>(publishableKey ? 'loading' : 'blocked')

  useEffect(() => {
    if (!publishableKey) {
      setState('blocked')
      return
    }

    let cancelled = false
    setState('loading')

    const timeout = new Promise<'blocked'>(resolve => {
      window.setTimeout(() => resolve('blocked'), STRIPE_PROBE_TIMEOUT_MS)
    })

    const load = loadStripe(publishableKey)
      .then(stripe => (stripe ? 'ready' : 'blocked'))
      .catch(() => 'blocked' as const)

    Promise.race([load, timeout]).then(result => {
      if (!cancelled) setState(result)
    })

    return () => {
      cancelled = true
    }
  }, [publishableKey])

  return state
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

const HostedLinkButton = memo(function HostedLinkButton({
  state,
  loadingLabel,
  readyLabel,
  onLaunch,
}: HostedLinkButtonProps) {
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
})

function Spinner() {
  return <span className="checkout-spinner" aria-hidden="true" />
}

type AwaitingBodyProps = {
  href: string
  timedOut: boolean
  onReopen: () => void
  onCancel: () => void
}

const AwaitingBody = memo(function AwaitingBody({
  href,
  timedOut,
  onReopen,
  onCancel,
}: AwaitingBodyProps) {
  return (
    <>
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
        href={href}
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
    </>
  )
})

const ManageBody = memo(function ManageBody() {
  return (
    <>
      <CurrentPlanCard />
      <p className="checkout-muted">
        Update your card or cancel your plan above. Plan switching is coming
        soon — for now, cancel and re-subscribe to change tier.
      </p>
    </>
  )
})

type CancelledBodyProps = {
  productName: string
  endDate?: string
  daysLeft: number | null
  formattedEndDate: string | null
  checkout: AsyncUrlState
  onLaunch: (href: string) => void
}

const CancelledBody = memo(function CancelledBody({
  productName,
  endDate,
  daysLeft,
  formattedEndDate,
  checkout,
  onLaunch,
}: CancelledBodyProps) {
  return (
    <>
      <h2>Your {productName} purchase is cancelled</h2>
      {endDate && formattedEndDate ? (
        <div className="checkout-notice">
          <p>
            <strong>Access expires {formattedEndDate}</strong>
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
        onLaunch={onLaunch}
      />
      {checkout.status === 'error' && (
        <p className="checkout-error" role="alert">
          {checkout.message}
        </p>
      )}
    </>
  )
})

type UpgradeBodyProps = {
  checkout: AsyncUrlState
  onLaunch: (href: string) => void
}

const UpgradeBody = memo(function UpgradeBody({ checkout, onLaunch }: UpgradeBodyProps) {
  return (
    <>
      <h2>Upgrade your plan</h2>
      <p className="checkout-muted">
        The SolvaPay checkout opens in a new tab. Return here after payment and your purchase will
        show up automatically.
      </p>
      <HostedLinkButton
        state={checkout}
        loadingLabel="Loading checkout…"
        readyLabel="Upgrade"
        onLaunch={onLaunch}
      />
      {checkout.status === 'error' && (
        <p className="checkout-error" role="alert">
          {checkout.message}
        </p>
      )}
    </>
  )
})

/**
 * The original hosted-button experience, kept as the probe-blocked
 * fallback. Unchanged logic — launches SolvaPay hosted checkout in a new
 * tab, polls `check_purchase` until the purchase flips active.
 */
function HostedCheckout({ productRef }: { productRef: string }) {
  const { loading, isRefetching, refetch, hasPaidPurchase, activePurchase } = usePurchase()
  const { cancelledPurchase, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } =
    usePurchaseStatus()
  const { _config } = useSolvaPay()

  const [awaiting, setAwaiting] = useState<AwaitingState | null>(null)
  const [awaitingTimedOut, setAwaitingTimedOut] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

  // `loading` starts `false` in the provider and only flips `true` for the
  // first fetch per cacheKey (subsequent polls report via `isRefetching`),
  // so gating directly on `!loading` would fire `useHostedUrl` before auth
  // detection and race `createCheckoutSession`. Flip a local latch the first
  // time `loading` transitions back to `false`.
  useEffect(() => {
    if (!loading && !hasLoadedOnce) setHasLoadedOnce(true)
  }, [loading, hasLoadedOnce])

  const fetchCheckoutUrl = useCallback(async () => {
    if (!_config?.transport) throw new Error('transport missing from provider config')
    const { checkoutUrl } = await _config.transport.createCheckoutSession({ productRef })
    return { href: checkoutUrl }
  }, [productRef, _config])

  // Pre-fetch checkout session once the initial purchase fetch has completed.
  const checkout = useHostedUrl(hasLoadedOnce, fetchCheckoutUrl, 'checkout session')

  const safeRefetch = useCallback(() => {
    refetch().catch(err => {
      console.warn('[mcp-checkout-ui] refetch failed', err)
    })
  }, [refetch])

  // Refetch on focus/visibility for when the user returns from the hosted tab.
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

  // While awaiting, poll so the card flips automatically even if the user
  // never returns focus (e.g. they leave the payment tab alongside).
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

  const dismissTimeout = useCallback(() => {
    setAwaitingTimedOut(false)
  }, [])

  // Derive primitive inputs for the memoised child bodies so they skip
  // re-renders when nothing they care about has changed.
  const activeProductName = activePurchase?.productName ?? null
  const cancelledProductName = cancelledPurchase?.productName ?? null
  const cancelledEndDate = cancelledPurchase?.endDate
  const cancelledDaysLeft = useMemo(
    () => (cancelledEndDate ? getDaysUntilExpiration(cancelledEndDate) : null),
    [cancelledEndDate, getDaysUntilExpiration],
  )
  const cancelledFormattedEndDate = useMemo(
    () => (cancelledEndDate ? formatDate(cancelledEndDate) : null),
    [cancelledEndDate, formatDate],
  )

  const awaitingHref = awaiting?.href ?? null

  const inner = useMemo(() => {
    if (awaiting && awaitingHref) {
      return (
        <AwaitingBody
          href={awaitingHref}
          timedOut={awaitingTimedOut}
          onReopen={dismissTimeout}
          onCancel={cancelAwaiting}
        />
      )
    }

    if (hasPaidPurchase && activeProductName) {
      return <ManageBody />
    }

    if (shouldShowCancelledNotice && cancelledProductName) {
      return (
        <CancelledBody
          productName={cancelledProductName}
          endDate={cancelledEndDate}
          daysLeft={cancelledDaysLeft}
          formattedEndDate={cancelledFormattedEndDate}
          checkout={checkout}
          onLaunch={beginAwaiting}
        />
      )
    }

    return <UpgradeBody checkout={checkout} onLaunch={beginAwaiting} />
  }, [
    awaiting,
    awaitingHref,
    awaitingTimedOut,
    dismissTimeout,
    cancelAwaiting,
    hasPaidPurchase,
    activeProductName,
    shouldShowCancelledNotice,
    cancelledProductName,
    cancelledEndDate,
    cancelledDaysLeft,
    cancelledFormattedEndDate,
    checkout,
    beginAwaiting,
  ])

  if (loading) {
    return (
      <div className="checkout-card">
        <p>Loading purchase…</p>
      </div>
    )
  }

  return (
    <div className="checkout-card" data-refreshing={isRefetching ? 'true' : undefined}>
      {inner}
    </div>
  )
}

/**
 * Gates `<PaymentForm.Root>` behind `PlanSelector`'s selection state.
 *
 * Mounting `PaymentForm.Root` immediately (before `usePlans` has loaded)
 * would fire its init `useEffect` with `effectivePlanRef = undefined`,
 * sending `useCheckout` into the `resolvePlanRef` path — which throws
 * "has N active plans but none is marked as default" on products without
 * a default. Waiting for `selectedPlanRef` (populated by
 * `autoSelectFirstPaid` once plans resolve) skips that path entirely.
 *
 * The `key={selectedPlanRef}` forces a fresh `PaymentForm.Root` instance
 * when the user picks a different card, so `useCheckout` reinitialises
 * the PaymentIntent against the new plan instead of keeping the old
 * `clientSecret`.
 */
function PaymentFormGate({
  productRef,
  children,
}: {
  productRef: string
  children: React.ReactNode
}) {
  const { selectedPlanRef } = usePlanSelector()
  if (!selectedPlanRef) return null
  return (
    <PaymentForm.Root
      key={selectedPlanRef}
      planRef={selectedPlanRef}
      productRef={productRef}
      requireTermsAcceptance={false}
    >
      {children}
    </PaymentForm.Root>
  )
}

/**
 * Embedded checkout body — only rendered when the Stripe probe reports
 * `'ready'`. Reuses the SDK's `<PaymentForm>` compound primitive so card
 * inputs mount inline as a nested `js.stripe.com` iframe (allowed by the
 * declared CSP `frameDomains`). Post-purchase management stays hosted —
 * the customer portal isn't embeddable today.
 */
function EmbeddedCheckout({ productRef }: { productRef: string }) {
  const { loading, isRefetching, hasPaidPurchase, activePurchase } = usePurchase()
  const { shouldShowCancelledNotice, cancelledPurchase } = usePurchaseStatus()

  if (loading) {
    return (
      <div className="checkout-card">
        <p>Loading purchase…</p>
      </div>
    )
  }

  const showManage = hasPaidPurchase && activePurchase?.productName
  const showRepurchase = shouldShowCancelledNotice && cancelledPurchase?.productName

  return (
    <div className="checkout-card" data-refreshing={isRefetching ? 'true' : undefined}>
      {showManage ? (
        <ManageBody />
      ) : (
        <>
          <h2>{showRepurchase ? 'Renew your plan' : 'Complete your purchase'}</h2>
          <PlanSelector.Root productRef={productRef} className="solvapay-plan-selector">
            <PlanSelector.Grid className="solvapay-plan-selector-grid">
              <PlanSelector.Card className="solvapay-plan-selector-card">
                <PlanSelector.CardBadge className="solvapay-plan-selector-card-badge" />
                <PlanSelector.CardName className="solvapay-plan-selector-card-name" />
                <PlanSelector.CardPrice className="solvapay-plan-selector-card-price" />
                <PlanSelector.CardInterval className="solvapay-plan-selector-card-interval" />
              </PlanSelector.Card>
            </PlanSelector.Grid>
            <PlanSelector.Loading className="solvapay-plan-selector-loading" />
            <PlanSelector.Error className="solvapay-plan-selector-error" />
            <PaymentFormGate productRef={productRef}>
              <PaymentForm.Summary />
              <PaymentForm.Loading />
              <PaymentForm.PaymentElement />
              <PaymentForm.Error />
              <PaymentForm.MandateText />
              <PaymentForm.SubmitButton className="hosted-button" />
            </PaymentFormGate>
          </PlanSelector.Root>
        </>
      )}
    </div>
  )
}

function CheckoutApp({
  productRef,
  publishableKey,
}: {
  productRef: string
  publishableKey: string | null
}) {
  const probe = useStripeProbe(publishableKey)

  return (
    <main className="main">
      <header className="header">
        <h1>SolvaPay</h1>
      </header>
      {probe === 'loading' ? (
        <div className="checkout-card">
          <p>Loading checkout…</p>
        </div>
      ) : probe === 'ready' ? (
        <EmbeddedCheckout productRef={productRef} />
      ) : (
        <HostedCheckout productRef={productRef} />
      )}
    </main>
  )
}

function Bootstrap() {
  const [ready, setReady] = useState(false)
  const [productRef, setProductRef] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
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

        const { productRef: ref, stripePublishableKey } = await fetchOpenCheckoutProductRef(app)
        if (!cancelled) {
          setProductRef(ref)
          setPublishableKey(stripePublishableKey)
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

  const providerConfig = useMemo(
    () => ({ auth: { adapter: mcpAuthAdapter }, transport, fetch: mcpFetch }),
    [],
  )

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

  return (
    <SolvaPayProvider config={providerConfig}>
      <CheckoutApp productRef={productRef} publishableKey={publishableKey} />
    </SolvaPayProvider>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element missing from mcp-app.html')
}
createRoot(rootEl).render(<Bootstrap />)
