'use client'

/**
 * `<McpCheckoutView>` — the paid-plan activation surface.
 *
 * Drives the two-branch activation UX from the paid-plan-activation
 * brief: PAYG (plan → amount → payment → success) and Recurring
 * (plan → payment → success). Both branches live in this file; the
 * internal `step` state machine keeps the shell on a single surface
 * per the brief's §6 invariant "same surface, different internal
 * state."
 *
 * ## Rendering paths
 *
 * - `useStripeProbe === 'ready'`   → `EmbeddedCheckout` with the full
 *   step state machine, `PlanSelector`, `TopupForm` (PAYG) and
 *   `PaymentForm` (recurring) mounted inline.
 * - `useStripeProbe === 'blocked'` → `HostedCheckout` — single
 *   "Upgrade" surface that launches SolvaPay hosted checkout in a new
 *   tab and polls `check_purchase` while the customer completes
 *   payment. Degraded path; doesn't exercise the new UX but keeps the
 *   CSP-restricted-host fallback working.
 * - `useStripeProbe === 'loading'` → interstitial spinner.
 *
 * ## Transport wiring (per brief §6)
 *
 * | Branch    | Step transition   | Transport tool(s)                    |
 * | --------- | ----------------- | ------------------------------------ |
 * | PAYG      | amount → payment  | `activate_plan` + `create_topup_payment_intent` |
 * | PAYG      | payment → success | `process_payment`                    |
 * | Recurring | plan → payment    | `create_payment_intent`              |
 * | Recurring | payment → success | `process_payment`                    |
 *
 * `activate_plan` fires *before* the PAYG payment so the customer's
 * active plan is already PAYG when the topup lands — the brief's
 * "replace Free" semantics.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { useTransport } from '../../hooks/useTransport'
import { usePurchase } from '../../hooks/usePurchase'
import { usePurchaseStatus } from '../../hooks/usePurchaseStatus'
import { AmountPicker, useAmountPicker } from '../../primitives/AmountPicker'
import { PaymentForm } from '../../primitives/PaymentForm'
import { PlanSelector, usePlanSelector } from '../../primitives/PlanSelector'
import { TopupForm } from '../../primitives/TopupForm'
import { formatPrice } from '../../utils/format'
import { useMcpBridge } from '../bridge'
import { useHostLocale } from '../useHostLocale'
import { useStripeProbe } from '../useStripeProbe'
import { BackLink } from './BackLink'
import { resolveMcpClassNames, type McpViewClassNames } from './types'
import type { Plan } from '../../types'

// Keep polling fast enough that the UI feels responsive after the user
// completes payment in the other tab, but not so fast that we hammer the
// MCP server if the user wanders off.
const POLL_INTERVAL_MS = 3_000
const AWAITING_TIMEOUT_MS = 10 * 60 * 1000

/** Shape of a bootstrap plan — structural subset so the view doesn't import `@solvapay/mcp` types. */
interface BootstrapPlanLike {
  reference?: string
  name?: string
  type?: string
  planType?: string
  price?: number
  currency?: string
  billingCycle?: string | null
  meterRef?: string | null
  creditsPerUnit?: number | null
  requiresPayment?: boolean
}

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
  /**
   * Called when the view wants to bounce the customer to the
   * dedicated Top up surface. Unused by the new activation flow
   * (PAYG top-ups happen inline here) but kept as a prop for
   * backward compatibility with integrators that wired it up.
   */
  onRequestTopup?: () => void
  /**
   * True when the checkout view was reached via the paywall takeover.
   * Drives the amber "Upgrade to continue" banner and the
   * `"Stay on Free"` dismiss link on the plan-selection step. The
   * brief's §6 invariant: "banner appears iff the customer hit the
   * paywall."
   */
  fromPaywall?: boolean
  /**
   * Paywall kind surfaced from `bootstrap.paywall.kind` when
   * `fromPaywall` is true. Selects between the two banner copies:
   * `'payment_required'` → quota-exhausted language;
   * `'activation_required'` → tool-needs-a-paid-plan language.
   */
  paywallKind?: 'payment_required' | 'activation_required'
  /**
   * Product plans snapshot from `bootstrap.plans`. Used to locate
   * the PAYG plan for the `popular` / `recommended` tag and sort
   * the plan cards (PAYG first, then recurring ascending). Falls
   * back to `PlanSelector`'s own `usePlans` fetch when omitted.
   */
  plans?: readonly BootstrapPlanLike[]
  /**
   * Invoked at the end of a successful activation — chained before
   * `onClose()` so the host sees a re-seeded bootstrap if it
   * re-invokes the original tool.
   */
  onRefreshBootstrap?: () => void | Promise<void>
  /**
   * Ask the host to unmount the MCP app. Wired by `<McpApp>` to
   * `app.requestTeardown()`. Used by `"Back to chat"` on the success
   * surface and the `"Stay on Free"` dismiss link. When omitted,
   * those affordances disappear.
   */
  onClose?: () => void
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
  onRefreshBootstrap,
  onClose,
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
        onRefreshBootstrap={onRefreshBootstrap}
        onClose={onClose}
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

type Step = 'plan' | 'amount' | 'payment' | 'success'

type SuccessMeta =
  | {
      branch: 'payg'
      amountMinor: number
      currency: string
      creditsAdded: number
      plan: BootstrapPlanLike
      rateLabel: string
    }
  | {
      branch: 'recurring'
      plan: BootstrapPlanLike
      creditsIncluded: number
      chargedTodayMinor: number
      currency: string
      nextRenewalLabel: string | null
    }

// --------------------------------------------------------------------
// Embedded checkout — step state machine
// --------------------------------------------------------------------

function EmbeddedCheckout({
  productRef,
  returnUrl,
  onPurchaseSuccess,
  fromPaywall,
  paywallKind,
  plans,
  onRefreshBootstrap,
  onClose,
  cx,
  children,
}: {
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  plans?: readonly BootstrapPlanLike[]
  onRefreshBootstrap?: () => void | Promise<void>
  onClose?: () => void
  cx: Cx
  children?: React.ReactNode
}) {
  const { loading, isRefetching } = usePurchase()

  // Memoised sort + popular resolution over the bootstrap plans so
  // `PlanSelector` gets a stable reference and the PAYG card renders
  // with the `"recommended"` tag without extra round-trips.
  const paidPlans = useMemo(() => {
    const list = (plans ?? []) as BootstrapPlanLike[]
    return list.filter((p) => p.requiresPayment !== false)
  }, [plans])
  const paygPlanRef = useMemo(() => {
    const payg = paidPlans.find((p) => isPayg(p))
    return payg?.reference
  }, [paidPlans])

  const [step, setStep] = useState<Step>('plan')
  const [selectedAmountMinor, setSelectedAmountMinor] = useState<number | null>(null)
  const [successMeta, setSuccessMeta] = useState<SuccessMeta | null>(null)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [isActivating, setIsActivating] = useState(false)

  if (loading) {
    return (
      <div className={cx.card}>
        <p>Loading checkout…</p>
      </div>
    )
  }

  return (
    <div className={cx.card} data-refreshing={isRefetching ? 'true' : undefined}>
      <PlanSelector.Root
        productRef={productRef}
        // Strip the Free plan — activation surface shows paid plans only.
        filter={planFilterPaid}
        // PAYG first, then recurring ascending by price.
        sortBy={planSortByPaygFirstThenAsc}
        popularPlanRef={paygPlanRef}
        // Don't auto-select on recurring-only shapes; the brief's
        // wireframe shows a neutral initial state with a
        // "Continue with …" CTA that only lights up once a plan is
        // selected.
        autoSelectFirstPaid={Boolean(paygPlanRef)}
        className="solvapay-plan-selector"
      >
        <CheckoutStateMachine
          step={step}
          setStep={setStep}
          selectedAmountMinor={selectedAmountMinor}
          setSelectedAmountMinor={setSelectedAmountMinor}
          successMeta={successMeta}
          setSuccessMeta={setSuccessMeta}
          activationError={activationError}
          setActivationError={setActivationError}
          isActivating={isActivating}
          setIsActivating={setIsActivating}
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          productRef={productRef}
          returnUrl={returnUrl}
          onPurchaseSuccess={onPurchaseSuccess}
          onRefreshBootstrap={onRefreshBootstrap}
          onClose={onClose}
          cx={cx}
        />
      </PlanSelector.Root>
      {children}
    </div>
  )
}

interface StateMachineProps {
  step: Step
  setStep: React.Dispatch<React.SetStateAction<Step>>
  selectedAmountMinor: number | null
  setSelectedAmountMinor: React.Dispatch<React.SetStateAction<number | null>>
  successMeta: SuccessMeta | null
  setSuccessMeta: React.Dispatch<React.SetStateAction<SuccessMeta | null>>
  activationError: string | null
  setActivationError: React.Dispatch<React.SetStateAction<string | null>>
  isActivating: boolean
  setIsActivating: React.Dispatch<React.SetStateAction<boolean>>
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  productRef: string
  returnUrl: string
  onPurchaseSuccess?: () => void
  onRefreshBootstrap?: () => void | Promise<void>
  onClose?: () => void
  cx: Cx
}

function CheckoutStateMachine(props: StateMachineProps) {
  const {
    step,
    setStep,
    selectedAmountMinor,
    setSelectedAmountMinor,
    successMeta,
    setSuccessMeta,
    activationError,
    setActivationError,
    isActivating,
    setIsActivating,
    fromPaywall,
    paywallKind,
    productRef,
    returnUrl,
    onPurchaseSuccess,
    onRefreshBootstrap,
    onClose,
    cx,
  } = props

  const { selectedPlan, selectedPlanRef, plans } = usePlanSelector()
  const transport = useTransport()
  const locale = useHostLocale()
  const { notifyModelContext, notifySuccess } = useMcpBridge()

  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null
  const branch: 'payg' | 'recurring' | null = selectedPlanShape
    ? isPayg(selectedPlanShape)
      ? 'payg'
      : 'recurring'
    : null

  // Transition: plan → (amount or payment). Emits
  // `ui/update-model-context` so the model sees the committed plan
  // selection before the customer finishes paying — Phase 1 of the
  // MCP Apps bridge alignment plan.
  const onPlanContinue = useCallback(() => {
    if (!selectedPlanShape || !selectedPlanRef) return
    setActivationError(null)
    void notifyModelContext({
      text: `User selected ${selectedPlanShape.name ?? 'a plan'}.`,
    })
    if (branch === 'payg') {
      setStep('amount')
      return
    }
    setStep('payment')
  }, [
    branch,
    notifyModelContext,
    selectedPlanRef,
    selectedPlanShape,
    setActivationError,
    setStep,
  ])

  // Transition: amount → payment. Fires `activate_plan` first so the
  // customer's active plan is PAYG by the time the topup intent is
  // created, then lets `TopupForm` take over.
  const onAmountContinue = useCallback(
    async (amountMinor: number) => {
      if (!selectedPlanRef) return
      setSelectedAmountMinor(amountMinor)
      setActivationError(null)
      setIsActivating(true)
      try {
        await transport.activatePlan({ productRef, planRef: selectedPlanRef })
        setStep('payment')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Activation failed'
        setActivationError(msg)
      } finally {
        setIsActivating(false)
      }
    },
    [
      productRef,
      selectedPlanRef,
      setActivationError,
      setIsActivating,
      setSelectedAmountMinor,
      setStep,
      transport,
    ],
  )

  // Transition: payment → success (PAYG branch).
  const onPaygPaymentSuccess = useCallback(() => {
    if (!selectedPlanShape || selectedAmountMinor == null) return
    const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
    const creditsPerUnit = selectedPlanShape.creditsPerUnit ?? 1
    const creditsAdded = Math.round(selectedAmountMinor * creditsPerUnit)
    setSuccessMeta({
      branch: 'payg',
      amountMinor: selectedAmountMinor,
      currency,
      creditsAdded,
      plan: selectedPlanShape,
      rateLabel: formatPaygRate(selectedPlanShape, locale),
    })
    setStep('success')
    void notifyModelContext({
      text: `Activated ${selectedPlanShape.name ?? 'plan'} with ${formatPrice(
        selectedAmountMinor,
        currency,
        { locale },
      )} in credits.`,
    })
    // Phase 5 — user-visible follow-up for topup+activation success.
    void notifySuccess({ kind: 'topup', amountMinor: selectedAmountMinor, currency })
    onPurchaseSuccess?.()
  }, [
    locale,
    notifyModelContext,
    notifySuccess,
    onPurchaseSuccess,
    selectedAmountMinor,
    selectedPlanShape,
    setStep,
    setSuccessMeta,
  ])

  // Transition: payment → success (Recurring branch).
  const onRecurringPaymentSuccess = useCallback(
    (_intent: PaymentIntent) => {
      if (!selectedPlanShape) return
      const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
      setSuccessMeta({
        branch: 'recurring',
        plan: selectedPlanShape,
        creditsIncluded: inferIncludedCredits(selectedPlanShape),
        chargedTodayMinor: selectedPlanShape.price ?? 0,
        currency,
        nextRenewalLabel: null, // server-provided — surfaced as null until wired.
      })
      setStep('success')
      void notifyModelContext({
        text: `Activated ${selectedPlanShape.name ?? 'plan'}.`,
      })
      void notifySuccess({
        kind: 'plan-activated',
        planName: selectedPlanShape.name ?? null,
      })
      onPurchaseSuccess?.()
    },
    [
      notifyModelContext,
      notifySuccess,
      onPurchaseSuccess,
      selectedPlanShape,
      setStep,
      setSuccessMeta,
    ],
  )

  // BackLink handlers.
  const onBackFromAmount = useCallback(() => {
    setActivationError(null)
    setStep('plan')
  }, [setActivationError, setStep])

  const onBackFromRecurringPayment = useCallback(() => {
    setStep('plan')
  }, [setStep])

  const onBackFromPaygPayment = useCallback(() => {
    setStep('amount')
  }, [setStep])

  // Success → unmount.
  const onBackToChat = useCallback(async () => {
    try {
      await Promise.resolve(onRefreshBootstrap?.())
    } catch {
      /* best-effort; the close path still fires. */
    }
    onClose?.()
  }, [onClose, onRefreshBootstrap])

  // "Stay on Free" dismiss.
  const onStayOnFree = useCallback(() => {
    onClose?.()
  }, [onClose])

  // No paid plans configured — defensive fallback; the server throws
  // in this case (see brief §2), but render a clear error anyway.
  if (plans.length === 0) {
    return (
      <>
        <h2 className={cx.heading}>Checkout unavailable</h2>
        <p className={cx.muted}>No paid plans are configured on this product.</p>
      </>
    )
  }

  switch (step) {
    case 'plan':
      return (
        <PlanStep
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          onContinue={onPlanContinue}
          // Per brief §6 invariant: `"Stay on Free"` lives on the
          // paywall-entry flow only. Change-plan re-entries from
          // `McpAccountView` leave it hidden so "switching plans"
          // doesn't double as "downgrade to Free."
          onStayOnFree={fromPaywall && onClose ? onStayOnFree : undefined}
          isActivating={isActivating}
          activationError={activationError}
          cx={cx}
        />
      )
    case 'amount':
      return (
        <AmountStep
          plan={selectedPlanShape!}
          onBack={onBackFromAmount}
          onContinue={onAmountContinue}
          isActivating={isActivating}
          activationError={activationError}
          cx={cx}
        />
      )
    case 'payment':
      if (branch === 'payg' && selectedPlanShape && selectedAmountMinor != null) {
        return (
          <PaygPaymentStep
            plan={selectedPlanShape}
            amountMinor={selectedAmountMinor}
            returnUrl={returnUrl}
            onBack={onBackFromPaygPayment}
            onSuccess={onPaygPaymentSuccess}
            cx={cx}
          />
        )
      }
      if (branch === 'recurring' && selectedPlanShape && selectedPlanRef) {
        return (
          <RecurringPaymentStep
            plan={selectedPlanShape}
            planRef={selectedPlanRef}
            productRef={productRef}
            returnUrl={returnUrl}
            onBack={onBackFromRecurringPayment}
            onSuccess={onRecurringPaymentSuccess}
            cx={cx}
          />
        )
      }
      // Shouldn't happen — fall back to plan.
      return (
        <PlanStep
          fromPaywall={fromPaywall}
          paywallKind={paywallKind}
          onContinue={onPlanContinue}
          onStayOnFree={fromPaywall && onClose ? onStayOnFree : undefined}
          isActivating={isActivating}
          activationError={activationError}
          cx={cx}
        />
      )
    case 'success':
      if (!successMeta) return null
      return (
        <SuccessStep
          meta={successMeta}
          onBackToChat={onBackToChat}
          cx={cx}
        />
      )
  }
}

// --------------------------------------------------------------------
// Step 1 — plan selection
// --------------------------------------------------------------------

const PlanStep = memo(function PlanStep({
  fromPaywall,
  paywallKind,
  onContinue,
  onStayOnFree,
  isActivating,
  activationError,
  cx,
}: {
  fromPaywall: boolean
  paywallKind?: 'payment_required' | 'activation_required'
  onContinue: () => void
  onStayOnFree?: () => void
  isActivating: boolean
  activationError: string | null
  cx: Cx
}) {
  const { selectedPlan, selectedPlanRef } = usePlanSelector()
  const locale = useHostLocale()
  const selectedPlanShape = selectedPlan as unknown as BootstrapPlanLike | null
  const ctaLabel = formatContinueLabel(selectedPlanShape, locale)

  return (
    <>
      {fromPaywall ? <UpgradeBanner kind={paywallKind} cx={cx} /> : null}

      <h2 className={cx.heading}>Choose a plan</h2>

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

      {activationError ? (
        <p className={cx.error} role="alert">
          {activationError}
        </p>
      ) : null}

      <button
        type="button"
        className={cx.button}
        disabled={!selectedPlanRef || isActivating}
        aria-disabled={!selectedPlanRef || isActivating}
        onClick={onContinue}
      >
        {ctaLabel}
      </button>

      {onStayOnFree ? (
        <button
          type="button"
          className={`${cx.linkButton ?? ''} solvapay-mcp-checkout-dismiss`.trim()}
          onClick={onStayOnFree}
          data-solvapay-mcp-checkout-stay-on-free=""
        >
          Stay on Free
        </button>
      ) : null}
    </>
  )
})

function UpgradeBanner({
  kind,
  cx,
}: {
  kind?: 'payment_required' | 'activation_required'
  cx: Cx
}) {
  // `payment_required` fires when the customer's active plan hit its
  // limit (quota exhausted on Free); `activation_required` fires when
  // no paid plan is active and the tool requires one.
  const copy =
    kind === 'payment_required'
      ? "You've used your free quota. Pick a plan to keep going."
      : 'This tool needs a paid plan. Pick one to get started.'
  return (
    <div
      className="solvapay-mcp-checkout-banner"
      role="status"
      data-solvapay-mcp-checkout-banner=""
    >
      <strong className="solvapay-mcp-checkout-banner-title">Upgrade to continue</strong>
      <span className={`${cx.muted} solvapay-mcp-checkout-banner-message`.trim()}>{copy}</span>
    </div>
  )
}

// --------------------------------------------------------------------
// Step 2 — PAYG amount picker
// --------------------------------------------------------------------

const AmountStep = memo(function AmountStep({
  plan,
  onBack,
  onContinue,
  isActivating,
  activationError,
  cx,
}: {
  plan: BootstrapPlanLike
  onBack: () => void
  onContinue: (amountMinor: number) => Promise<void>
  isActivating: boolean
  activationError: string | null
  cx: Cx
}) {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const locale = useHostLocale()

  const [stagedAmountMinor, setStagedAmountMinor] = useState<number | null>(null)

  return (
    <>
      <BackLink label="Back" onClick={onBack} />

      <h2 className={cx.heading}>How many credits?</h2>
      <p className={cx.muted}>Top up to start using the tool.</p>

      <AmountPicker.Root
        currency={currency}
        emit="minor"
        className={cx.amountPicker}
        onChange={(value) => setStagedAmountMinor(value)}
      >
        <PresetAmountRow cx={cx} />
        <AmountPicker.Custom className={cx.amountCustom} placeholder="or custom amount" />
        <AmountPicker.Confirm
          className={cx.button}
          onConfirm={(amountMinor) => {
            void onContinue(amountMinor)
          }}
        >
          {isActivating
            ? 'Activating…'
            : stagedAmountMinor
              ? `Continue — ${formatPrice(stagedAmountMinor, currency, { locale })}`
              : 'Continue'}
        </AmountPicker.Confirm>
      </AmountPicker.Root>

      {activationError ? (
        <p className={cx.error} role="alert">
          {activationError}
        </p>
      ) : null}
    </>
  )
})

function PresetAmountRow({ cx }: { cx: Cx }) {
  const { quickAmounts, currencySymbol } = useAmountPicker()
  // Recommended preset: the second option (index 1) when available —
  // matches the pre-refactor wireframe's "middle chip" treatment.
  const popularIndex = Math.min(1, quickAmounts.length - 1)
  return (
    <div className={cx.amountOptions}>
      {quickAmounts.map((amount, i) => (
        <AmountPicker.Option
          key={amount}
          amount={amount}
          className={cx.amountOption}
          data-popular={i === popularIndex ? '' : undefined}
          aria-label={`${currencySymbol}${amount.toLocaleString()}${i === popularIndex ? ' (popular)' : ''}`}
        />
      ))}
    </div>
  )
}

// --------------------------------------------------------------------
// Step 3a — PAYG payment (after `activate_plan` fired).
// --------------------------------------------------------------------

const PaygPaymentStep = memo(function PaygPaymentStep({
  plan,
  amountMinor,
  returnUrl,
  onBack,
  onSuccess,
  cx,
}: {
  plan: BootstrapPlanLike
  amountMinor: number
  returnUrl: string
  onBack: () => void
  onSuccess: () => void
  cx: Cx
}) {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const locale = useHostLocale()
  const creditsPerUnit = plan.creditsPerUnit ?? 1
  const creditsAdded = Math.round(amountMinor * creditsPerUnit)

  return (
    <>
      <BackLink label="Change amount" onClick={onBack} />

      <h2 className={cx.heading}>Payment</h2>

      <div className="solvapay-mcp-checkout-order-summary" data-variant="payg">
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>{creditsAdded.toLocaleString(locale)} credits</span>
          <span>{formatPrice(amountMinor, currency, { locale })}</span>
        </div>
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>One-time</span>
        </div>
      </div>

      <TopupForm.Root
        amount={amountMinor}
        currency={currency}
        returnUrl={returnUrl}
        className={cx.topupForm}
        onSuccess={() => onSuccess()}
      >
        <TopupForm.Loading />
        <TopupForm.PaymentElement />
        <TopupForm.Error className={cx.error} />

        {/* Per brief §4: optional "Save card for future top-ups"
            checkbox below the Stripe element. Purely informational
            today — Stripe's default `setup_future_usage` from the
            intent dictates whether the card actually gets saved. */}
        <label className="solvapay-mcp-checkout-save-card">
          <input type="checkbox" defaultChecked />
          <span className={cx.muted}>Save card for future top-ups</span>
        </label>

        <TopupForm.SubmitButton className={cx.button}>
          Pay {formatPrice(amountMinor, currency, { locale })}
        </TopupForm.SubmitButton>
      </TopupForm.Root>
    </>
  )
})

// --------------------------------------------------------------------
// Step 3b — Recurring payment.
// --------------------------------------------------------------------

const RecurringPaymentStep = memo(function RecurringPaymentStep({
  plan,
  planRef,
  productRef,
  returnUrl,
  onBack,
  onSuccess,
  cx,
}: {
  plan: BootstrapPlanLike
  planRef: string
  productRef: string
  returnUrl: string
  onBack: () => void
  onSuccess: (intent: PaymentIntent) => void
  cx: Cx
}) {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const locale = useHostLocale()
  const amountMinor = plan.price ?? 0
  const cycle = plan.billingCycle ?? 'monthly'
  const credits = inferIncludedCredits(plan)
  const planName = plan.name ?? 'Plan'

  return (
    <>
      <BackLink label="Change plan" onClick={onBack} />

      <h2 className={cx.heading}>Payment</h2>

      <div className="solvapay-mcp-checkout-order-summary" data-variant="recurring">
        <div className="solvapay-mcp-checkout-order-summary-row">
          <span className={cx.muted}>
            {planName} · {cycle}
          </span>
          <span>{formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}</span>
        </div>
        {credits > 0 ? (
          <div className="solvapay-mcp-checkout-order-summary-row">
            <span className={cx.muted}>{credits.toLocaleString(locale)} credits included</span>
          </div>
        ) : null}
      </div>

      <PaymentForm.Root
        planRef={planRef}
        productRef={productRef}
        returnUrl={returnUrl}
        requireTermsAcceptance={false}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuccess={onSuccess as any}
      >
        <PaymentForm.Loading />
        <PaymentForm.PaymentElement />
        <PaymentForm.Error className={cx.error} />

        <p className={`${cx.muted} solvapay-mcp-checkout-terms`.trim()}>
          By subscribing, you agree {planName} renews at{' '}
          {formatPrice(amountMinor, currency, { locale })}/{cycle} until you cancel.
        </p>

        <PaymentForm.SubmitButton className={cx.button}>
          Subscribe — {formatPrice(amountMinor, currency, { locale })} / {cycle}
        </PaymentForm.SubmitButton>
      </PaymentForm.Root>
    </>
  )
})

// --------------------------------------------------------------------
// Step 4 — shared success surface.
// --------------------------------------------------------------------

const SuccessStep = memo(function SuccessStep({
  meta,
  onBackToChat,
  cx,
}: {
  meta: SuccessMeta
  onBackToChat: () => Promise<void>
  cx: Cx
}) {
  const locale = useHostLocale()
  if (meta.branch === 'payg') {
    return (
      <>
        <div className="solvapay-mcp-checkout-success-check" aria-hidden="true">
          ✓
        </div>
        <h2 className={cx.heading}>Credits added</h2>
        <p className={cx.muted}>Pay as you go plan is active.</p>

        <dl className="solvapay-mcp-checkout-receipt" data-variant="payg">
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Amount</dt>
            <dd>{formatPrice(meta.amountMinor, meta.currency, { locale })}</dd>
          </div>
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Credits</dt>
            <dd>+{meta.creditsAdded.toLocaleString(locale)}</dd>
          </div>
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Plan</dt>
            <dd>{meta.plan.name ?? 'Pay as you go'}</dd>
          </div>
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Rate</dt>
            <dd>{meta.rateLabel}</dd>
          </div>
        </dl>

        <button
          type="button"
          className={cx.button}
          data-variant="success"
          onClick={() => {
            void onBackToChat()
          }}
        >
          Back to chat
        </button>
      </>
    )
  }

  return (
    <>
      <div className="solvapay-mcp-checkout-success-check" aria-hidden="true">
        ✓
      </div>
      <h2 className={cx.heading}>{meta.plan.name ?? 'Plan'} active</h2>
      <p className={cx.muted}>Subscription is live and credits are ready.</p>

      <dl className="solvapay-mcp-checkout-receipt" data-variant="recurring">
        <div className="solvapay-mcp-checkout-receipt-row">
          <dt>Plan</dt>
          <dd>{meta.plan.name ?? 'Plan'}</dd>
        </div>
        {meta.creditsIncluded > 0 ? (
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Credits</dt>
            <dd>+{meta.creditsIncluded.toLocaleString(locale)}</dd>
          </div>
        ) : null}
        <div className="solvapay-mcp-checkout-receipt-row">
          <dt>Charged today</dt>
          <dd>{formatPrice(meta.chargedTodayMinor, meta.currency, { locale })}</dd>
        </div>
        {meta.nextRenewalLabel ? (
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Next renewal</dt>
            <dd>{meta.nextRenewalLabel}</dd>
          </div>
        ) : null}
      </dl>

      <p className={`${cx.muted} solvapay-mcp-checkout-manage-pointer`.trim()}>
        Manage from <code>/manage_account</code>
      </p>

      <button
        type="button"
        className={cx.button}
        data-variant="success"
        onClick={() => {
          void onBackToChat()
        }}
      >
        Back to chat
      </button>
    </>
  )
})

// --------------------------------------------------------------------
// Derivation helpers
// --------------------------------------------------------------------

function isPayg(plan: BootstrapPlanLike | null | undefined): boolean {
  if (!plan) return false
  const type = plan.planType ?? plan.type
  return type === 'usage-based' || type === 'hybrid'
}

function planFilterPaid(plan: Plan): boolean {
  // `requiresPayment === false` marks a Free plan in the server
  // schema; we exclude those from the activation surface (per the
  // brief's §3 — no Free card).
  return plan.requiresPayment !== false
}

function planSortByPaygFirstThenAsc(a: Plan, b: Plan): number {
  const aPayg = isPayg(a as unknown as BootstrapPlanLike)
  const bPayg = isPayg(b as unknown as BootstrapPlanLike)
  if (aPayg && !bPayg) return -1
  if (!aPayg && bPayg) return 1
  return (a.price ?? 0) - (b.price ?? 0)
}

function formatContinueLabel(plan: BootstrapPlanLike | null, locale?: string): string {
  if (!plan) return 'Continue'
  if (isPayg(plan)) {
    return `Continue with ${plan.name ?? 'Pay as you go'}`
  }
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const priceLabel = formatPrice(plan.price ?? 0, currency, { locale })
  const cycle = plan.billingCycle ? `/${shortCycle(plan.billingCycle)}` : ''
  return `Continue with ${plan.name ?? 'Plan'} — ${priceLabel}${cycle}`
}

function formatPaygRate(plan: BootstrapPlanLike, locale?: string): string {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const creditsPerUnit = plan.creditsPerUnit ?? 1
  // One currency unit per credit at the plan's rate. Minor-unit
  // representation: 1 credit = 1 / creditsPerUnit of a minor unit.
  const perCreditMinor = Math.max(1, Math.round(1 / creditsPerUnit))
  return `${formatPrice(perCreditMinor, currency, { locale })} / call`
}

function inferIncludedCredits(plan: BootstrapPlanLike): number {
  // Best-effort: for recurring-unlimited-with-included-credits, the
  // server surfaces this via a dedicated field in future revisions;
  // V1 relies on `creditsPerUnit` × price (minor units) as a fallback.
  const price = plan.price ?? 0
  const creditsPerUnit = plan.creditsPerUnit ?? 0
  if (price > 0 && creditsPerUnit > 0) {
    return Math.round(price * creditsPerUnit)
  }
  return 0
}

function shortCycle(cycle: string | null | undefined): string {
  if (!cycle) return 'mo'
  const lc = cycle.toLowerCase()
  if (lc.startsWith('year') || lc === 'annually' || lc === 'annual') return 'yr'
  if (lc.startsWith('week')) return 'wk'
  if (lc.startsWith('day')) return 'd'
  return 'mo'
}

// --------------------------------------------------------------------
// Hosted-checkout fallback (unchanged semantics — the degraded path
// for CSP-blocked hosts. The new activation UX lives in
// `EmbeddedCheckout`; this fallback keeps a single "Upgrade" surface
// working as before.)
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
        aria-label={`${readyLabel} (opens in a new tab)`}
        onClick={() => onLaunch?.(state.href)}
      >
        <button type="button" className={cx.button}>
          {readyLabel}
          <span className="solvapay-mcp-external-glyph" aria-hidden="true">
            {' '}↗
          </span>
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
        aria-label="Reopen checkout (opens in a new tab)"
        onClick={() => onReopen()}
      >
        <button type="button" className={cx.button}>
          Reopen checkout
          <span className="solvapay-mcp-external-glyph" aria-hidden="true">
            {' '}↗
          </span>
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

  // Mirror `EmbeddedCheckout`'s success semantics — fire once after
  // the hosted-checkout poll confirms a new paid purchase.
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

