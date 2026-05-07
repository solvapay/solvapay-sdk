'use client'

/**
 * `<McpCheckoutView>` — the paid-plan activation surface for MCP hosts.
 *
 * Three rendering paths gated by `useStripeProbe`:
 *
 *  - `useStripeProbe === 'ready'`   → `<EmbeddedCheckout>` from
 *    `./checkout` — the stepped activation flow built on
 *    `useCheckoutFlow`.
 *  - `useStripeProbe === 'blocked'` → local `HostedCheckout` (new-tab
 *    fallback with `check_purchase` polling).
 *  - `useStripeProbe === 'loading'` → interstitial spinner.
 *
 * The MCP-specific bits (bridge wiring, "Stay on Free" affordance,
 * banner copy) live in this file. The state engine and step layout
 * are shared with the web/chatbot flows via `useCheckoutFlow` +
 * `<CheckoutSteps.*>` — see `./checkout/EmbeddedCheckout.tsx`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTransport } from '../../hooks/useTransport'
import { usePurchase } from '../../hooks/usePurchase'
import { usePurchaseStatus } from '../../hooks/usePurchaseStatus'
import { useStripeProbe } from '../useStripeProbe'
import { resolveMcpClassNames, type McpViewClassNames } from './types'
import { ExternalLinkGlyph } from '../../components/ExternalLinkGlyph'
import { EmbeddedCheckout } from './checkout'
import type { BootstrapPlanLike, Cx } from './checkout'

const POLL_INTERVAL_MS = 3_000
const AWAITING_TIMEOUT_MS = 10 * 60 * 1000

export interface McpCheckoutViewProps {
  productRef: string
  /**
   * Stripe publishable key used by `useStripeProbe` to detect CSP-blocked
   * hosts. Pass `null` to skip the probe and render the hosted fallback
   * directly.
   */
  publishableKey?: string | null
  returnUrl: string
  onPurchaseSuccess?: () => void
  /**
   * @deprecated PAYG top-ups happen inline now; retained for backward
   * compatibility with integrators that wired it up.
   */
  onRequestTopup?: () => void
  /**
   * `true` when the view was reached via a paywall takeover. Drives the
   * amber "Upgrade to continue" banner and the `"Stay on Free"` dismiss
   * link on the plan-selection step.
   */
  fromPaywall?: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  plans?: readonly BootstrapPlanLike[]
  /**
   * @deprecated No longer wired — kept on the public type for backward
   * compatibility. The shell-level on-mount refresh is wired separately
   * via `<McpAppShell>`.
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Ask the host to unmount the MCP app. Wired by `<McpApp>` to
   * `app.requestTeardown()`. Used by the `"Stay on Free"` dismiss link.
   */
  onClose?: () => void
  /**
   * Called when the user picks "Back to my account" at the top of the
   * plan picker. Wired by `<McpAppShell>` whenever the shell owns
   * surface routing.
   */
  onBack?: () => void
  classNames?: McpViewClassNames
  children?: React.ReactNode
}

export function McpCheckoutView({
  productRef,
  publishableKey = null,
  returnUrl,
  onPurchaseSuccess,
  onRequestTopup: _onRequestTopup,
  fromPaywall = false,
  paywallKind,
  plans,
  onClose,
  onBack,
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
        fromPaywall={fromPaywall}
        paywallKind={paywallKind}
        plans={plans}
        onClose={onClose}
        onBack={onBack}
        cx={cx}
        classNames={classNames}
      >
        {children}
      </EmbeddedCheckout>
    )
  }
  return (
    <HostedCheckout productRef={productRef} onPurchaseSuccess={onPurchaseSuccess} cx={cx}>
      {children}
    </HostedCheckout>
  )
}

// --------------------------------------------------------------------
// Hosted-checkout fallback (unchanged semantics — the degraded path
// for CSP-blocked hosts).
// --------------------------------------------------------------------

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

const HostedLinkButton = React.memo(function HostedLinkButton({
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
        aria-label={`${readyLabel} (opens in a new tab)`}
        onClick={() => onLaunch?.(state.href)}
      >
        <button type="button" className={cx.button}>
          {readyLabel}
          <ExternalLinkGlyph />
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

const AwaitingBody = React.memo(function AwaitingBody({
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
        aria-label="Reopen checkout (opens in a new tab)"
        onClick={() => onReopen()}
      >
        <button type="button" className={cx.button}>
          Reopen checkout
          <ExternalLinkGlyph />
        </button>
      </a>
      <button type="button" className={cx.linkButton} onClick={onCancel}>
        {"Didn't complete? Cancel"}
      </button>
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

const CancelledBody = React.memo(function CancelledBody({
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

const UpgradeBody = React.memo(function UpgradeBody({ checkout, onLaunch, cx }: UpgradeBodyProps) {
  return (
    <>
      <h2 className={cx.heading}>Upgrade your plan</h2>
      <p className={cx.muted}>
        The SolvaPay checkout opens in a new tab. Return here after payment and your purchase will
        show up automatically.
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

  const onPurchaseSuccessRef = useRef(onPurchaseSuccess)
  useEffect(() => {
    onPurchaseSuccessRef.current = onPurchaseSuccess
  }, [onPurchaseSuccess])

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
    const isNewPurchase = !awaiting.baselineHadPaidPurchase || newRef !== awaiting.baselineActiveRef
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
