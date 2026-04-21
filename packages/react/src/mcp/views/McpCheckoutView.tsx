'use client'

/**
 * `<McpCheckoutView>` — the checkout screen surfaced by the `open_checkout`
 * MCP tool.
 *
 * Uses `useStripeProbe` to decide between two rendering paths:
 *  - `'ready'`  → `EmbeddedCheckout` with `<PaymentForm>` mounting Stripe
 *    Elements inline.
 *  - `'blocked'`→ `HostedCheckout` polling `check_purchase` while the user
 *    completes payment in a popped-out tab.
 *  - `'loading'`→ interstitial spinner.
 *
 * Post-purchase state (active paid purchase, cancelled-with-access, etc.)
 * is rendered identically in both paths via the same memoised body
 * components (`<ManageBody>`, `<CancelledBody>`, `<UpgradeBody>`).
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CurrentPlanCard } from '../../components/CurrentPlanCard'
import { useTransport } from '../../hooks/useTransport'
import { usePurchase } from '../../hooks/usePurchase'
import { usePurchaseStatus } from '../../hooks/usePurchaseStatus'
import { PaymentForm } from '../../primitives/PaymentForm'
import { PlanSelector, usePlanSelector } from '../../primitives/PlanSelector'
import { useStripeProbe } from '../useStripeProbe'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

// Keep polling fast enough that the UI feels responsive after the user
// completes payment in the other tab, but not so fast that we hammer the
// MCP server if the user wanders off.
const POLL_INTERVAL_MS = 3_000
const AWAITING_TIMEOUT_MS = 10 * 60 * 1000

export interface McpCheckoutViewProps {
  productRef: string
  /**
   * Stripe publishable key used by `useStripeProbe` to detect CSP-blocked
   * hosts. Pass `null` to skip the probe and render the hosted fallback
   * directly (useful for tests or hosts known to refuse `js.stripe.com`).
   */
  publishableKey?: string | null
  returnUrl: string
  onPurchaseSuccess?: () => void
  classNames?: McpViewClassNames
  children?: React.ReactNode
}

export function McpCheckoutView({
  productRef,
  publishableKey = null,
  returnUrl,
  onPurchaseSuccess,
  classNames,
  children,
}: McpCheckoutViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const probe = useStripeProbe(publishableKey)

  if (probe === 'loading') {
    return (
      <div className={cx.card}>
        <p>Loading checkout…</p>
        {children}
      </div>
    )
  }
  if (probe === 'ready') {
    return (
      <EmbeddedCheckout
        productRef={productRef}
        returnUrl={returnUrl}
        onPurchaseSuccess={onPurchaseSuccess}
        cx={cx}
      >
        {children}
      </EmbeddedCheckout>
    )
  }
  return (
    <HostedCheckout
      productRef={productRef}
      onPurchaseSuccess={onPurchaseSuccess}
      cx={cx}
    >
      {children}
    </HostedCheckout>
  )
}

type Cx = ReturnType<typeof resolveMcpClassNames>

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

  // `setState` inside this effect syncs a transient fetch state machine to
  // the `enabled` / `fetcher` external inputs — there's no downstream
  // derivation we can rearrange into render. Lint suppression is
  // intentional.
  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  cx: Cx
}

const HostedLinkButton = memo(function HostedLinkButton({
  state,
  loadingLabel,
  readyLabel,
  onLaunch,
  cx,
}: HostedLinkButtonProps) {
  if (state.status === 'ready') {
    return (
      <a
        className="solvapay-mcp-hosted-link"
        href={state.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onLaunch?.(state.href)}
      >
        <button type="button" className={cx.button}>
          {readyLabel}
        </button>
      </a>
    )
  }

  return (
    <button type="button" className={cx.button} disabled>
      {state.status === 'error' ? 'Unavailable' : loadingLabel}
    </button>
  )
})

function Spinner() {
  return <span className="solvapay-mcp-spinner" aria-hidden="true" />
}

type AwaitingBodyProps = {
  href: string
  timedOut: boolean
  onReopen: () => void
  onCancel: () => void
  cx: Cx
}

const AwaitingBody = memo(function AwaitingBody({
  href,
  timedOut,
  onReopen,
  onCancel,
  cx,
}: AwaitingBodyProps) {
  return (
    <>
      <div className={cx.awaitingHeader}>
        <Spinner />
        <h2 className={cx.heading}>
          {timedOut ? 'Still waiting for payment' : 'Waiting for payment…'}
        </h2>
      </div>
      <p className={cx.muted}>
        {timedOut
          ? "We haven't seen your purchase yet. If you completed payment, give it another moment — otherwise reopen checkout or cancel."
          : 'Complete payment in the other tab. Your purchase will show up here automatically.'}
      </p>
      <a
        className="solvapay-mcp-hosted-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onReopen()}
      >
        <button type="button" className={cx.button}>
          Reopen checkout
        </button>
      </a>
      <button type="button" className={cx.linkButton} onClick={onCancel}>
        {"Didn't complete? Cancel"}
      </button>
    </>
  )
})

const ManageBody = memo(function ManageBody({ cx }: { cx: Cx }) {
  return (
    <>
      <CurrentPlanCard />
      <p className={cx.muted}>
        Update your card or cancel your plan above. Plan switching is coming soon — for now,
        cancel and re-subscribe to change tier.
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
  cx: Cx
}

const CancelledBody = memo(function CancelledBody({
  productName,
  endDate,
  daysLeft,
  formattedEndDate,
  checkout,
  onLaunch,
  cx,
}: CancelledBodyProps) {
  return (
    <>
      <h2 className={cx.heading}>Your {productName} purchase is cancelled</h2>
      {endDate && formattedEndDate ? (
        <div className={cx.notice}>
          <p>
            <strong>Access expires {formattedEndDate}</strong>
          </p>
          {daysLeft !== null && daysLeft > 0 && (
            <p className={cx.muted}>
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
            </p>
          )}
        </div>
      ) : (
        <p className={cx.muted}>Your purchase access has ended.</p>
      )}
      <HostedLinkButton
        state={checkout}
        loadingLabel="Loading checkout…"
        readyLabel="Purchase again"
        onLaunch={onLaunch}
        cx={cx}
      />
      {checkout.status === 'error' && (
        <p className={cx.error} role="alert">
          {checkout.message}
        </p>
      )}
    </>
  )
})

type UpgradeBodyProps = {
  checkout: AsyncUrlState
  onLaunch: (href: string) => void
  cx: Cx
}

const UpgradeBody = memo(function UpgradeBody({ checkout, onLaunch, cx }: UpgradeBodyProps) {
  return (
    <>
      <h2 className={cx.heading}>Upgrade your plan</h2>
      <p className={cx.muted}>
        The SolvaPay checkout opens in a new tab. Return here after payment and your purchase
        will show up automatically.
      </p>
      <HostedLinkButton
        state={checkout}
        loadingLabel="Loading checkout…"
        readyLabel="Upgrade"
        onLaunch={onLaunch}
        cx={cx}
      />
      {checkout.status === 'error' && (
        <p className={cx.error} role="alert">
          {checkout.message}
        </p>
      )}
    </>
  )
})

/**
 * Hosted-button fallback. Unchanged logic — launches SolvaPay hosted
 * checkout in a new tab, polls `check_purchase` until the purchase
 * flips active.
 */
function HostedCheckout({
  productRef,
  onPurchaseSuccess,
  cx,
  children,
}: {
  productRef: string
  onPurchaseSuccess?: () => void
  cx: Cx
  children?: React.ReactNode
}) {
  const { loading, isRefetching, refetch, hasPaidPurchase, activePurchase } = usePurchase()
  const { cancelledPurchase, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } =
    usePurchaseStatus()
  const transport = useTransport()

  const [awaiting, setAwaiting] = useState<AwaitingState | null>(null)
  const [awaitingTimedOut, setAwaitingTimedOut] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

  // Mirror EmbeddedCheckout's `onSuccess` semantics — fire once after the
  // hosted-checkout poll confirms a new paid purchase. Capture in a ref so
  // inline arrow consumers don't churn the effect deps.
  const onPurchaseSuccessRef = useRef(onPurchaseSuccess)
  useEffect(() => {
    onPurchaseSuccessRef.current = onPurchaseSuccess
  }, [onPurchaseSuccess])

  // `loading` starts `false` in the provider and only flips `true` for the
  // first fetch per cacheKey (subsequent polls report via `isRefetching`),
  // so gating directly on `!loading` would fire `useHostedUrl` before auth
  // detection and race `createCheckoutSession`. Flip a local latch the
  // first time `loading` transitions back to `false`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!loading && !hasLoadedOnce) setHasLoadedOnce(true)
  }, [loading, hasLoadedOnce])

  const fetchCheckoutUrl = useCallback(async () => {
    const { checkoutUrl } = await transport.createCheckoutSession({ productRef })
    return { href: checkoutUrl }
  }, [productRef, transport])

  const checkout = useHostedUrl(hasLoadedOnce, fetchCheckoutUrl, 'checkout session')

  const safeRefetch = useCallback(() => {
    refetch().catch(err => {
      console.warn('[solvapay-mcp] refetch failed', err)
    })
  }, [refetch])

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

  useEffect(() => {
    if (!awaiting) return
    if (!hasPaidPurchase) return
    const newRef = activePurchase?.reference ?? null
    const isNewPurchase =
      !awaiting.baselineHadPaidPurchase || newRef !== awaiting.baselineActiveRef
    if (isNewPurchase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAwaiting(null)
      setAwaitingTimedOut(false)
      onPurchaseSuccessRef.current?.()
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
          cx={cx}
        />
      )
    }

    if (hasPaidPurchase && activeProductName) {
      return <ManageBody cx={cx} />
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
          cx={cx}
        />
      )
    }

    return <UpgradeBody checkout={checkout} onLaunch={beginAwaiting} cx={cx} />
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
    cx,
  ])

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading purchase…</p>
      </div>
    )
  }

  return (
    <div className={cx.card} data-refreshing={isRefetching ? 'true' : undefined}>
      {inner}
      {children}
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
  returnUrl,
  onSuccess,
  children,
}: {
  productRef: string
  returnUrl: string
  onSuccess?: () => void
  children: React.ReactNode
}) {
  const { selectedPlanRef } = usePlanSelector()
  if (!selectedPlanRef) return null
  return (
    <PaymentForm.Root
      key={selectedPlanRef}
      planRef={selectedPlanRef}
      productRef={productRef}
      returnUrl={returnUrl}
      requireTermsAcceptance={false}
      onSuccess={onSuccess}
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
function EmbeddedCheckout({
  productRef,
  returnUrl,
  onPurchaseSuccess,
  cx,
  children,
}: {
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  cx: Cx
  children?: React.ReactNode
}) {
  const { loading, isRefetching, hasPaidPurchase, activePurchase } = usePurchase()
  const { shouldShowCancelledNotice, cancelledPurchase } = usePurchaseStatus()

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading purchase…</p>
      </div>
    )
  }

  const showManage = hasPaidPurchase && activePurchase?.productName
  const showRepurchase = shouldShowCancelledNotice && cancelledPurchase?.productName

  return (
    <div className={cx.card} data-refreshing={isRefetching ? 'true' : undefined}>
      {showManage ? (
        <ManageBody cx={cx} />
      ) : (
        <>
          <h2 className={cx.heading}>
            {showRepurchase ? 'Renew your plan' : 'Complete your purchase'}
          </h2>
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
            <PaymentFormGate
              productRef={productRef}
              returnUrl={returnUrl}
              onSuccess={onPurchaseSuccess}
            >
              <PaymentForm.Summary />
              <PaymentForm.Loading />
              <PaymentForm.PaymentElement />
              <PaymentForm.Error />
              <PaymentForm.MandateText />
              <PaymentForm.SubmitButton className={cx.button} />
            </PaymentFormGate>
          </PlanSelector.Root>
        </>
      )}
      {children}
    </div>
  )
}
