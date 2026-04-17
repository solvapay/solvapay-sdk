'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PaymentForm } from '../PaymentForm'
import { PlanSelector } from './PlanSelector'
import { ActivationFlow } from './ActivationFlow'
import { usePlan } from '../hooks/usePlan'
import { useCopy } from '../hooks/useCopy'
import type { PaymentIntent } from '@stripe/stripe-js'
import type {
  ActivationResult,
  CheckoutResult,
  Plan,
  PrefillCustomer,
} from '../types'

export type CheckoutLayoutSize = 'chat' | 'mobile' | 'desktop' | 'auto'

export type CheckoutLayoutClassNames = {
  root?: string
  summary?: string
  form?: string
  mandate?: string
  submit?: string
  planSelector?: string
  continueButton?: string
  backButton?: string
}

export type CheckoutLayoutPlanSelectorOptions = {
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  popularPlanRef?: string
}

export type CheckoutLayoutProps = {
  /**
   * Plan reference. When passed, skips plan selection and goes directly to
   * payment or activation (routed based on plan type). Backwards compatible
   * with today's payment-only behavior for non-usage-based plans.
   */
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  size?: CheckoutLayoutSize
  requireTermsAcceptance?: boolean
  /**
   * Fires on paid completions only — preserved for backwards compatibility.
   * For a unified callback across paid + activated flows, use `onResult`.
   */
  onSuccess?: (paymentIntent: PaymentIntent) => void
  /** Unified completion callback (paid + activated). */
  onResult?: (result: CheckoutResult) => void
  /** Override the default free-plan activation step. Forwarded to PaymentForm. */
  onFreePlan?: (plan: Plan) => Promise<unknown> | void
  onError?: (error: Error) => void
  /** Initial selection when rendering the selector step. */
  initialPlanRef?: string
  /** Callback when the user picks a plan from the selector. */
  onPlanSelect?: (planRef: string, plan: Plan) => void
  /** Controls for the internal `<PlanSelector>`. */
  planSelector?: CheckoutLayoutPlanSelectorOptions
  /** Hide the "← Back to plans" affordance on the pay step. Defaults to true. */
  showBackButton?: boolean
  /**
   * Rarely needed escape hatch: fully replace the default `<ActivationFlow>`.
   * The callback receives `{ plan, productRef, onBack }` and returns a
   * React node. Prefer composition via classNames/slots on `<ActivationFlow>`
   * unless you need to swap out the orchestrator wholesale.
   */
  renderActivation?: (args: {
    plan: Plan
    productRef: string
    onBack: () => void
    onResult?: (result: ActivationResult) => void
  }) => React.ReactNode
  submitButtonText?: string
  returnUrl?: string
  classNames?: CheckoutLayoutClassNames
}

type ResolvedSize = 'chat' | 'mobile' | 'desktop'
type Step = 'select' | 'pay' | 'activate'

const BREAKPOINTS = {
  chat: 480,
  desktop: 768,
} as const

function widthToSize(width: number): ResolvedSize {
  if (width < BREAKPOINTS.chat) return 'chat'
  if (width < BREAKPOINTS.desktop) return 'mobile'
  return 'desktop'
}

/**
 * Opinionated one-line drop-in checkout.
 *
 * - **Without `planRef`** — renders the full flow: `<PlanSelector>` → pay or
 *   activate. Single-plan products auto-skip selection.
 * - **With `planRef`** — jumps straight to pay (paid/free plans) or activate
 *   (usage-based plans), preserving the payment-only behavior that existing
 *   integrators rely on.
 *
 * The layout also adapts to its container width (chat / mobile / desktop)
 * via `ResizeObserver` so it works identically inside a chat bubble, a phone
 * viewport, or a full-page desktop layout.
 */
export const CheckoutLayout: React.FC<CheckoutLayoutProps> = ({
  planRef,
  productRef,
  prefillCustomer,
  size = 'auto',
  requireTermsAcceptance,
  onSuccess,
  onResult,
  onFreePlan,
  onError,
  initialPlanRef,
  onPlanSelect,
  planSelector,
  showBackButton = true,
  renderActivation,
  submitButtonText,
  returnUrl,
  classNames,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [autoSize, setAutoSize] = useState<ResolvedSize>('desktop')
  const copy = useCopy()

  useEffect(() => {
    if (size !== 'auto') return
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        setAutoSize(widthToSize(w))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [size])

  const resolvedSize: ResolvedSize = size === 'auto' ? autoSize : size
  const isDesktop = resolvedSize === 'desktop'
  const isChat = resolvedSize === 'chat'

  // When planRef is passed, we skip the select step but still route usage-based
  // to ActivationFlow. When planRef is omitted, we run the select → pay|activate
  // machine internally.
  const [selectedPlanRef, setSelectedPlanRef] = useState<string | null>(
    planRef ?? initialPlanRef ?? null,
  )
  const [step, setStep] = useState<Step>(
    planRef ? 'pay' : selectedPlanRef ? 'pay' : 'select',
  )

  const effectivePlanRef = planRef ?? selectedPlanRef ?? undefined
  const { plan: resolvedPlan } = usePlan({
    planRef: effectivePlanRef,
    productRef,
  })
  const isUsageBased = resolvedPlan?.type === 'usage-based'

  // Flip to 'activate' once we know the selected plan is usage-based.
  useEffect(() => {
    if (step === 'pay' && isUsageBased) setStep('activate')
    if (step === 'activate' && resolvedPlan && !isUsageBased) setStep('pay')
  }, [step, isUsageBased, resolvedPlan])

  const handlePlanSelect = useCallback(
    (ref: string, plan: Plan) => {
      setSelectedPlanRef(ref)
      onPlanSelect?.(ref, plan)
      setStep(plan.type === 'usage-based' ? 'activate' : 'pay')
    },
    [onPlanSelect],
  )

  const handleBack = useCallback(() => {
    if (planRef) return
    setStep('select')
  }, [planRef])

  const rootStyle: React.CSSProperties = {
    display: 'grid',
    gap: isDesktop ? 24 : 16,
    gridTemplateColumns:
      isDesktop && step === 'pay' ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
    padding: isChat ? 8 : isDesktop ? 24 : 16,
    fontSize: resolvedSize === 'mobile' ? 15 : 14,
  }

  const backButton = !planRef && showBackButton && step !== 'select' && (
    <button
      type="button"
      onClick={handleBack}
      data-solvapay-checkout-back=""
      className={classNames?.backButton}
      style={{
        alignSelf: 'flex-start',
        background: 'none',
        border: 'none',
        color: 'rgba(0,0,0,0.6)',
        fontSize: 14,
        cursor: 'pointer',
        padding: 0,
        marginBottom: 8,
      }}
    >
      {copy.planSelector.backButton}
    </button>
  )

  let body: React.ReactNode
  if (step === 'select') {
    body = (
      <SelectBody
        productRef={productRef ?? ''}
        initialPlanRef={initialPlanRef ?? selectedPlanRef ?? undefined}
        filter={planSelector?.filter}
        sortBy={planSelector?.sortBy}
        popularPlanRef={planSelector?.popularPlanRef}
        onSelect={handlePlanSelect}
        classNames={classNames}
      />
    )
  } else if (step === 'activate' && resolvedPlan && productRef) {
    body = renderActivation ? (
      renderActivation({
        plan: resolvedPlan,
        productRef,
        onBack: handleBack,
        onResult: result => onResult?.(result),
      })
    ) : (
      <ActivationFlow
        productRef={productRef}
        planRef={effectivePlanRef}
        onBack={planRef ? undefined : handleBack}
        onSuccess={result => onResult?.(result)}
        onError={onError}
      />
    )
  } else {
    // step === 'pay'
    body = (
      <PaymentForm
        planRef={effectivePlanRef}
        productRef={productRef}
        prefillCustomer={prefillCustomer}
        requireTermsAcceptance={requireTermsAcceptance}
        onSuccess={onSuccess}
        onResult={onResult}
        onFreePlan={onFreePlan}
        onError={onError}
        submitButtonText={submitButtonText}
        returnUrl={returnUrl}
      >
        <section
          className={classNames?.summary}
          data-solvapay-layout-section="summary"
          style={{ gridColumn: isDesktop ? '1 / 2' : '1 / -1' }}
        >
          <PaymentForm.Summary />
          <PaymentForm.CustomerFields />
        </section>
        <section
          className={classNames?.form}
          data-solvapay-layout-section="form"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            gridColumn: isDesktop ? '2 / 3' : '1 / -1',
          }}
        >
          {isChat ? <PaymentForm.CardElement /> : <PaymentForm.PaymentElement />}
          <PaymentForm.Error />
          <PaymentForm.MandateText className={classNames?.mandate} />
          {requireTermsAcceptance && <PaymentForm.TermsCheckbox />}
          <PaymentForm.SubmitButton className={classNames?.submit} />
        </section>
      </PaymentForm>
    )
  }

  return (
    <div
      ref={rootRef}
      data-solvapay-checkout-layout={resolvedSize}
      data-solvapay-step={step}
      className={classNames?.root}
      style={rootStyle}
    >
      {backButton}
      {body}
    </div>
  )
}

/**
 * Plan-selection step body. Factored out so we can auto-skip single-plan
 * products via an effect on the resolved plans, without polluting the parent
 * with a plans-hook dependency that only matters during selection.
 */
const SelectBody: React.FC<{
  productRef: string
  initialPlanRef?: string
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  popularPlanRef?: string
  onSelect: (planRef: string, plan: Plan) => void
  classNames?: CheckoutLayoutClassNames
}> = ({ productRef, initialPlanRef, filter, sortBy, popularPlanRef, onSelect, classNames }) => {
  const copy = useCopy()
  const autoSkipRef = useRef(false)

  return (
    <PlanSelector
      productRef={productRef}
      filter={filter}
      sortBy={sortBy}
      initialPlanRef={initialPlanRef}
      popularPlanRef={popularPlanRef}
      autoSelectFirstPaid
      onSelect={onSelect}
      className={classNames?.planSelector}
    >
      {args => {
        // Auto-skip when filtering leaves exactly one selectable plan.
        const selectable = args.plans.filter(
          p => p.requiresPayment !== false && !args.isCurrentPlan(p.reference),
        )
        if (
          !autoSkipRef.current &&
          !args.loading &&
          selectable.length === 1 &&
          args.plans.length === 1
        ) {
          autoSkipRef.current = true
          onSelect(selectable[0].reference, selectable[0])
        }

        return (
          <RenderedSelector
            args={args}
            popularPlanRef={popularPlanRef}
            onSelect={onSelect}
            continueLabel={copy.planSelector.continueButton}
            classNames={classNames}
          />
        )
      }}
    </PlanSelector>
  )
}

/**
 * Renders the default grid + Continue button inside the PlanSelector
 * function-child. Separated so the `onSelect` keyboard path and the CTA
 * button share a single handler.
 */
const RenderedSelector: React.FC<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any
  popularPlanRef?: string
  onSelect: (planRef: string, plan: Plan) => void
  continueLabel: string
  classNames?: CheckoutLayoutClassNames
}> = ({ args, popularPlanRef, onSelect, continueLabel, classNames }) => {
  const copy = useCopy()
  // args is from PlanSelectorRenderArgs — render the default grid ourselves
  // so the Continue button can live inside this step container.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'rgba(0,0,0,0.75)',
          letterSpacing: 0.2,
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        {copy.planSelector.heading}
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {args.plans.map((plan: Plan) => {
          const isCurrent = args.isCurrentPlan(plan.reference)
          const isFree = args.isFreePlan(plan.reference)
          const isPopular = popularPlanRef === plan.reference
          const selected = args.selectedPlanRef === plan.reference
          return (
            <button
              key={plan.reference}
              type="button"
              disabled={isFree || isCurrent}
              onClick={() => args.select(plan.reference)}
              data-selected={selected || undefined}
              style={{
                position: 'relative',
                padding: '20px 16px',
                border: `2px solid ${selected ? '#16a34a' : 'rgba(0,0,0,0.12)'}`,
                borderRadius: 12,
                background: isFree || isCurrent ? 'rgba(0,0,0,0.03)' : '#fff',
                cursor: isFree || isCurrent ? 'not-allowed' : 'pointer',
                opacity: isFree || isCurrent ? 0.6 : 1,
                textAlign: 'left',
                boxShadow: selected ? '0 0 0 3px rgba(22,163,74,0.12)' : 'none',
                transition: 'border-color 120ms ease, box-shadow 120ms ease',
              }}
            >
              {isCurrent && (
                <span
                  style={{
                    position: 'absolute',
                    top: -10,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#0f172a',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 10px',
                    borderRadius: 999,
                  }}
                >
                  {copy.planSelector.currentBadge}
                </span>
              )}
              {!isCurrent && isPopular && !isFree && (
                <span
                  style={{
                    position: 'absolute',
                    top: -10,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#3b82f6',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 10px',
                    borderRadius: 999,
                  }}
                >
                  {copy.planSelector.popularBadge}
                </span>
              )}
              {plan.name && (
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', marginBottom: 4 }}>
                  {plan.name}
                </div>
              )}
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>
                {isFree
                  ? copy.planSelector.freeBadge
                  : formatPlanPrice(plan, copy.interval.free)}
              </div>
              {!isFree && plan.interval && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                  /{plan.interval}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        disabled={!args.selectedPlan}
        onClick={() => {
          if (args.selectedPlan) onSelect(args.selectedPlan.reference, args.selectedPlan)
        }}
        className={classNames?.continueButton}
        style={{
          padding: '12px 20px',
          borderRadius: 8,
          border: 'none',
          background: args.selectedPlan ? '#0f172a' : 'rgba(0,0,0,0.15)',
          color: '#fff',
          fontWeight: 600,
          fontSize: 15,
          cursor: args.selectedPlan ? 'pointer' : 'not-allowed',
        }}
      >
        {continueLabel}
      </button>
    </div>
  )
}

function formatPlanPrice(plan: Plan, freeLabel: string): string {
  if (!plan.price) return freeLabel
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (plan.currency ?? 'usd').toUpperCase(),
      minimumFractionDigits: 2,
    }).format(plan.price / 100)
  } catch {
    return `${plan.currency ?? '$'}${(plan.price / 100).toFixed(2)}`
  }
}
