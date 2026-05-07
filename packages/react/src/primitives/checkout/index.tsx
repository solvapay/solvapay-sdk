'use client'

/**
 * `CheckoutSteps.*` — opt-in styled parts that compose on top of
 * `useCheckoutFlow`. Each part consumes the flow via `CheckoutContext`
 * and renders the right primitive (PlanSelector grid, AmountPicker,
 * PaymentForm / TopupForm, etc.) wired to the matching transition.
 *
 * `<CheckoutSteps.Root>` mounts a `<PlanSelector.Root>` and creates
 * a `useCheckoutFlow` instance internally (or accepts an external
 * `flow={…}` for power users who want shared state across surfaces).
 *
 * Class names follow the `solvapay-checkout-*` namespace. MCP and
 * paywall surfaces add their own ancestor selectors (e.g.
 * `.solvapay-mcp-shell .solvapay-checkout-card`) rather than
 * remapping classNames per call site — see the plan brief for the
 * "no className mapping" rule.
 */

import React, { createContext, forwardRef, useContext, useMemo } from 'react'
import type { PaymentIntent } from '@stripe/stripe-js'
import { PlanSelector } from '../PlanSelector'
import { AmountPicker as AmountPickerPrimitive, useAmountPicker } from '../AmountPicker'
import { PaymentForm } from '../PaymentForm'
import { TopupForm } from '../TopupForm'
import { MandateText } from '../MandateText'
import { useBalance } from '../../hooks/useBalance'
import { useLocale } from '../../hooks/useCopy'
import { useCheckoutFlow, type UseCheckoutFlowReturn } from '../../hooks/useCheckoutFlow'
import { formatPrice, getMinorUnitsPerMajor } from '../../utils/format'
import type { Plan } from '../../types'
import { usePlans } from '../../hooks/usePlans'
import {
  buildDefaultCheckoutPlanFilter,
  formatContinueLabel,
  planSortByPaygFirstThenAsc,
  shortCycle,
  type BootstrapPlanLike,
  type CheckoutStep,
} from './shared'

const CheckoutContext = createContext<UseCheckoutFlowReturn | null>(null)

function useCheckoutContext(part: string): UseCheckoutFlowReturn {
  const ctx = useContext(CheckoutContext)
  if (!ctx) {
    throw new Error(`CheckoutSteps.${part} must be rendered inside <CheckoutSteps.Root>.`)
  }
  return ctx
}

/**
 * Read the active flow from inside a `<CheckoutSteps.Root>`. Mirrors
 * `usePlanSelector` / `usePaywallNotice` — exposed for custom parts
 * that integrators build alongside the default ones.
 */
export function useCheckoutSteps(): UseCheckoutFlowReturn {
  return useCheckoutContext('useCheckoutSteps')
}

interface RootProps {
  productRef: string
  returnUrl: string
  /** External flow instance for shared state across surfaces. */
  flow?: UseCheckoutFlowReturn
  initialStep?: CheckoutStep
  initialPlanRef?: string
  initialAmountMinor?: number
  /** Forwarded to PlanSelector — defaults to `false` so the hook owns selection. */
  autoSelectFirstPaid?: boolean
  /**
   * When the product exposes only one selectable plan, auto-select it
   * and advance past the plan step. Defaults to `true`. Forwarded to
   * `useCheckoutFlow`; see that hook for the trade-off note.
   */
  autoSkipSinglePlan?: boolean
  /** Forwarded to PlanSelector — already supports filtering Free. */
  filter?: (plan: Plan, index: number) => boolean
  /** Forwarded to PlanSelector — defaults to PAYG-first sort. */
  sortBy?: (a: Plan, b: Plan) => number
  popularPlanRef?: string
  currentPlanRef?: string | null
  onPlanSelect?: (planRef: string, plan: Plan) => void
  onAmountSelect?: (amountMinor: number, currency: string) => void
  onPurchaseSuccess?: (meta: NonNullable<UseCheckoutFlowReturn['successMeta']>) => void
  onError?: (err: Error, phase: 'activate' | 'pay') => void
  className?: string
  children?: React.ReactNode
}

const Root = forwardRef<HTMLDivElement, RootProps>(function CheckoutStepsRoot(props, forwardedRef) {
  const {
    productRef,
    returnUrl: _returnUrl,
    flow: externalFlow,
    initialStep,
    initialPlanRef,
    initialAmountMinor,
    autoSelectFirstPaid = false,
    autoSkipSinglePlan = true,
    filter,
    sortBy = planSortByPaygFirstThenAsc,
    popularPlanRef,
    currentPlanRef,
    onPlanSelect,
    onAmountSelect,
    onPurchaseSuccess,
    onError,
    className,
    children,
  } = props

  if (externalFlow) {
    return (
      <div ref={forwardedRef} data-solvapay-checkout="" className={className}>
        <CheckoutContext.Provider value={externalFlow}>{children}</CheckoutContext.Provider>
      </div>
    )
  }

  return (
    <RootWithPlanSelector
      productRef={productRef}
      filter={filter}
      sortBy={sortBy}
      popularPlanRef={popularPlanRef}
      currentPlanRef={currentPlanRef}
      autoSelectFirstPaid={autoSelectFirstPaid}
      initialPlanRef={initialPlanRef}
      forwardedRef={forwardedRef}
      className={className}
      initialStep={initialStep}
      initialAmountMinor={initialAmountMinor}
      autoSkipSinglePlan={autoSkipSinglePlan}
      onPlanSelect={onPlanSelect}
      onAmountSelect={onAmountSelect}
      onPurchaseSuccess={onPurchaseSuccess}
      onError={onError}
    >
      {children}
    </RootWithPlanSelector>
  )
})

interface RootWithPlanSelectorProps extends Pick<
  RootProps,
  | 'productRef'
  | 'sortBy'
  | 'popularPlanRef'
  | 'currentPlanRef'
  | 'autoSelectFirstPaid'
  | 'initialPlanRef'
  | 'className'
  | 'initialStep'
  | 'initialAmountMinor'
  | 'autoSkipSinglePlan'
  | 'onPlanSelect'
  | 'onAmountSelect'
  | 'onPurchaseSuccess'
  | 'onError'
  | 'children'
> {
  /** Explicit filter from the consumer; `undefined` triggers the default. */
  filter?: RootProps['filter']
  forwardedRef?: React.ForwardedRef<HTMLDivElement>
}

/**
 * Hoists a `usePlans` prefetch so `<CheckoutSteps.Root>` can default
 * `filter` to `buildDefaultCheckoutPlanFilter(plans)` when the consumer
 * omits one. `usePlans` has a global module cache keyed by `productRef`,
 * so the inner `<PlanSelector.Root>`'s own `usePlans` call hits cache.
 */
function RootWithPlanSelector({
  productRef,
  filter,
  sortBy,
  popularPlanRef,
  currentPlanRef,
  autoSelectFirstPaid,
  initialPlanRef,
  forwardedRef,
  className,
  initialStep,
  initialAmountMinor,
  autoSkipSinglePlan,
  onPlanSelect,
  onAmountSelect,
  onPurchaseSuccess,
  onError,
  children,
}: RootWithPlanSelectorProps) {
  const { plans } = usePlans({ productRef })
  const resolvedFilter = useMemo(
    () => filter ?? buildDefaultCheckoutPlanFilter(plans),
    [filter, plans],
  )
  return (
    <PlanSelector.Root
      productRef={productRef}
      filter={resolvedFilter}
      sortBy={sortBy}
      popularPlanRef={popularPlanRef}
      currentPlanRef={currentPlanRef}
      autoSelectFirstPaid={autoSelectFirstPaid}
      initialPlanRef={initialPlanRef}
    >
      <FlowProvider
        productRef={productRef}
        forwardedRef={forwardedRef}
        className={className}
        initialStep={initialStep}
        initialAmountMinor={initialAmountMinor}
        autoSkipSinglePlan={autoSkipSinglePlan}
        onPlanSelect={onPlanSelect}
        onAmountSelect={onAmountSelect}
        onPurchaseSuccess={onPurchaseSuccess}
        onError={onError}
      >
        {children}
      </FlowProvider>
    </PlanSelector.Root>
  )
}

interface FlowProviderProps extends Pick<
  RootProps,
  | 'productRef'
  | 'initialStep'
  | 'initialAmountMinor'
  | 'autoSkipSinglePlan'
  | 'onPlanSelect'
  | 'onAmountSelect'
  | 'onPurchaseSuccess'
  | 'onError'
  | 'className'
  | 'children'
> {
  forwardedRef?: React.ForwardedRef<HTMLDivElement>
}

function FlowProvider({
  productRef,
  initialStep,
  initialAmountMinor,
  autoSkipSinglePlan,
  onPlanSelect,
  onAmountSelect,
  onPurchaseSuccess,
  onError,
  className,
  forwardedRef,
  children,
}: FlowProviderProps) {
  const flow = useCheckoutFlow({
    productRef,
    initialStep,
    initialAmountMinor,
    autoSkipSinglePlan,
    onPlanSelect,
    onAmountSelect,
    onPurchaseSuccess,
    onError,
  })
  return (
    <div ref={forwardedRef} data-solvapay-checkout="" data-step={flow.step} className={className}>
      <CheckoutContext.Provider value={flow}>{children}</CheckoutContext.Provider>
    </div>
  )
}

interface IfStepProps {
  step: CheckoutStep | readonly CheckoutStep[]
  children: React.ReactNode
}

function IfStep({ step, children }: IfStepProps) {
  const flow = useCheckoutContext('IfStep')
  const matches = Array.isArray(step) ? step.includes(flow.step) : flow.step === step
  if (!matches) return null
  return <>{children}</>
}

interface PlanGridProps {
  className?: string
  /** Override the grid contents — defaults to a Card with badge/name/price/interval. */
  children?: React.ReactNode
}

function PlanGrid({ className, children }: PlanGridProps) {
  return (
    <PlanSelector.Grid className={className ?? 'solvapay-checkout-plan-grid'}>
      {children ?? (
        <PlanSelector.Card className="solvapay-checkout-plan-card">
          <PlanSelector.CardBadge className="solvapay-checkout-plan-card-badge" />
          <PlanSelector.CardName className="solvapay-checkout-plan-card-name" />
          <PlanSelector.CardPrice className="solvapay-checkout-plan-card-price" />
          <PlanSelector.CardInterval className="solvapay-checkout-plan-card-interval" />
        </PlanSelector.Card>
      )}
    </PlanSelector.Grid>
  )
}

type PlanContinueButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children?: React.ReactNode
}

const PlanContinueButton = forwardRef<HTMLButtonElement, PlanContinueButtonProps>(
  function PlanContinueButton({ className, children, onClick, disabled, ...rest }, ref) {
    const flow = useCheckoutContext('PlanContinueButton')
    const locale = useLocale()
    const selectedPlanShape = flow.selectedPlan as unknown as BootstrapPlanLike | null
    const isDisabled = disabled || !flow.selectedPlanRef || flow.status === 'activating'
    const label = children ?? formatContinueLabel(selectedPlanShape, locale)
    return (
      <button
        ref={ref}
        type="button"
        className={className ?? 'solvapay-checkout-continue-button'}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        data-solvapay-checkout-continue=""
        onClick={e => {
          onClick?.(e)
          if (e.defaultPrevented) return
          void flow.advance()
        }}
        {...rest}
      >
        {label}
      </button>
    )
  },
)

interface AmountPickerProps {
  className?: string
  /** Optional override — defaults to a 4-up preset row + custom input. */
  children?: React.ReactNode
}

function AmountPicker({ className, children }: AmountPickerProps) {
  const flow = useCheckoutContext('AmountPicker')
  const selectedPlanShape = flow.selectedPlan as unknown as BootstrapPlanLike | null
  const currency = (selectedPlanShape?.currency ?? 'USD').toUpperCase()
  return (
    <AmountPickerPrimitive.Root
      currency={currency}
      emit="minor"
      className={className ?? 'solvapay-checkout-amount-picker'}
      onChange={value => {
        if (typeof value === 'number') {
          flow.selectAmount(value)
        }
      }}
    >
      {children ?? (
        <>
          <PresetAmountRow />
          <AmountPickerPrimitive.Custom
            className="solvapay-checkout-amount-custom"
            placeholder="or custom amount"
          />
        </>
      )}
    </AmountPickerPrimitive.Root>
  )
}

function PresetAmountRow() {
  const { quickAmounts, currency } = useAmountPicker()
  const locale = useLocale()
  const popularIndex = Math.min(1, quickAmounts.length - 1)
  return (
    <div className="solvapay-checkout-amount-options">
      {quickAmounts.map((amount, i) => {
        const label = formatPrice(amount * getMinorUnitsPerMajor(currency), currency, {
          locale,
          free: '',
        })
        return (
          <AmountPickerPrimitive.Option
            key={amount}
            amount={amount}
            className="solvapay-checkout-amount-option"
            data-popular={i === popularIndex ? '' : undefined}
            aria-label={`${label}${i === popularIndex ? ' (popular)' : ''}`}
          />
        )
      })}
    </div>
  )
}

type AmountContinueButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children?: React.ReactNode
}

const AmountContinueButton = forwardRef<HTMLButtonElement, AmountContinueButtonProps>(
  function AmountContinueButton({ className, children, onClick, disabled, ...rest }, ref) {
    const flow = useCheckoutContext('AmountContinueButton')
    const locale = useLocale()
    const selectedPlanShape = flow.selectedPlan as unknown as BootstrapPlanLike | null
    const currency = (selectedPlanShape?.currency ?? 'USD').toUpperCase()
    const isDisabled = disabled || flow.selectedAmountMinor == null
    const label =
      children ??
      (flow.selectedAmountMinor != null
        ? `Continue — ${formatPrice(flow.selectedAmountMinor, currency, { locale })}`
        : 'Continue')
    return (
      <AmountPickerPrimitive.Confirm
        ref={ref}
        className={className ?? 'solvapay-checkout-continue-button'}
        disabled={isDisabled}
        onConfirm={amount => {
          flow.selectAmount(amount)
          void flow.advance()
        }}
        onClick={onClick}
        {...rest}
      >
        {label}
      </AmountPickerPrimitive.Confirm>
    )
  },
)

interface PaymentProps {
  className?: string
}

function Payment({ className }: PaymentProps) {
  const flow = useCheckoutContext('Payment')
  if (flow.branch === 'payg') {
    return <PaygPayment className={className} />
  }
  if (flow.branch === 'recurring') {
    return <RecurringPayment className={className} />
  }
  return null
}

function PaygPayment({ className }: { className?: string }) {
  const flow = useCheckoutContext('Payment')
  const locale = useLocale()
  const { creditsPerMinorUnit, displayExchangeRate } = useBalance()
  // Read all context up front so the hook order is stable across the
  // null-guard early return below (rules-of-hooks).
  const returnUrl = useReturnUrl()
  const selectedPlanShape = flow.selectedPlan as unknown as BootstrapPlanLike | null
  const amountMinor = flow.selectedAmountMinor
  if (!selectedPlanShape || amountMinor == null) return null
  const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
  const creditsAdded =
    creditsPerMinorUnit != null && creditsPerMinorUnit > 0
      ? Math.floor((amountMinor / (displayExchangeRate ?? 1)) * creditsPerMinorUnit)
      : null

  return (
    <div className={className ?? 'solvapay-checkout-payment'} data-branch="payg">
      <div className="solvapay-checkout-order-summary" data-variant="payg">
        <div className="solvapay-checkout-order-summary-row">
          <span>
            {creditsAdded != null
              ? `${creditsAdded.toLocaleString(locale)} credits`
              : formatPrice(amountMinor, currency, { locale })}
          </span>
          {creditsAdded != null ? (
            <span>{formatPrice(amountMinor, currency, { locale })}</span>
          ) : null}
        </div>
      </div>
      <TopupForm.Root
        amount={amountMinor}
        currency={currency}
        returnUrl={returnUrl}
        className="solvapay-checkout-topup-form"
        onSuccess={() => flow.notifyPaymentSuccess()}
      >
        <TopupForm.Loading />
        <TopupForm.PaymentElement />
        <TopupForm.Error className="solvapay-checkout-error" />
        <MandateText mode="topup" amountMinor={amountMinor} currency={currency} />
        <TopupForm.SubmitButton className="solvapay-checkout-pay-button">
          Pay {formatPrice(amountMinor, currency, { locale })}
        </TopupForm.SubmitButton>
      </TopupForm.Root>
    </div>
  )
}

function RecurringPayment({ className }: { className?: string }) {
  const flow = useCheckoutContext('Payment')
  const locale = useLocale()
  const returnUrl = useReturnUrl()
  const productRef = useProductRef()
  const selectedPlanShape = flow.selectedPlan as unknown as BootstrapPlanLike | null
  if (!selectedPlanShape || !flow.selectedPlanRef) return null
  const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
  const amountMinor = selectedPlanShape.price ?? 0
  const cycle = selectedPlanShape.billingCycle ?? 'monthly'
  const planName = selectedPlanShape.name ?? 'Plan'
  return (
    <div className={className ?? 'solvapay-checkout-payment'} data-branch="recurring">
      <div className="solvapay-checkout-order-summary" data-variant="recurring">
        <div className="solvapay-checkout-order-summary-row">
          <span>{planName}</span>
          <span>
            {formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}
          </span>
        </div>
      </div>
      <PaymentForm.Root
        planRef={flow.selectedPlanRef}
        productRef={productRef}
        returnUrl={returnUrl}
        requireTermsAcceptance={false}
        onSuccess={(intent: PaymentIntent) => flow.notifyPaymentSuccess(intent)}
      >
        <PaymentForm.Loading />
        <PaymentForm.PaymentElement />
        <PaymentForm.Error className="solvapay-checkout-error" />
        <PaymentForm.MandateText />
        <PaymentForm.SubmitButton className="solvapay-checkout-pay-button">
          Subscribe — {formatPrice(amountMinor, currency, { locale })}/{shortCycle(cycle)}
        </PaymentForm.SubmitButton>
      </PaymentForm.Root>
    </div>
  )
}

// Provide returnUrl + productRef via a tiny secondary context so the
// Payment parts don't need to thread props from <Root>.
interface CheckoutEnvValue {
  returnUrl: string
  productRef: string
}

const CheckoutEnvContext = createContext<CheckoutEnvValue | null>(null)

function useReturnUrl(): string {
  return useContext(CheckoutEnvContext)?.returnUrl ?? ''
}

function useProductRef(): string {
  return useContext(CheckoutEnvContext)?.productRef ?? ''
}

type BackLinkProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Visible label; sensible default per step. */
  label?: string
  /** Override the arrow glyph (defaults to `←`). */
  glyph?: string
}

const BackLink = forwardRef<HTMLButtonElement, BackLinkProps>(function CheckoutStepsBackLink(
  { label, glyph = '←', className, onClick, ...rest },
  ref,
) {
  const flow = useCheckoutContext('BackLink')
  // Suppress the link when there's nowhere meaningful to go back to —
  // e.g. recurring single-plan payment after `autoSkipSinglePlan`
  // landed the user there. Avoids dropping the user into a one-card
  // grid they can't act on.
  if (!flow.canGoBack) return null
  const resolvedLabel =
    label ??
    (flow.step === 'payment' && flow.branch === 'payg'
      ? 'Change amount'
      : flow.step === 'payment' && flow.branch === 'recurring'
        ? 'Change plan'
        : 'Back')
  return (
    <button
      ref={ref}
      type="button"
      className={['solvapay-checkout-back-link', className].filter(Boolean).join(' ')}
      data-solvapay-checkout-back=""
      onClick={e => {
        onClick?.(e)
        if (e.defaultPrevented) return
        flow.back()
      }}
      {...rest}
    >
      <span className="solvapay-checkout-back-link-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="solvapay-checkout-back-link-label">{resolvedLabel}</span>
    </button>
  )
})

interface SuccessProps {
  className?: string
  /** Custom success body — defaults to a PAYG / recurring receipt. */
  children?: React.ReactNode
}

function Success({ className, children }: SuccessProps) {
  const flow = useCheckoutContext('Success')
  const locale = useLocale()
  if (flow.step !== 'success' || !flow.successMeta) return null
  if (children) {
    return <div className={className ?? 'solvapay-checkout-success'}>{children}</div>
  }
  const meta = flow.successMeta
  if (meta.branch === 'payg') {
    return (
      <div className={className ?? 'solvapay-checkout-success'} data-branch="payg">
        <div className="solvapay-checkout-success-check" aria-hidden="true">
          ✓
        </div>
        <h2 className="solvapay-checkout-success-heading">Credits added</h2>
        <p className="solvapay-checkout-success-subheading">Pay as you go plan is active.</p>
        <dl className="solvapay-checkout-receipt" data-variant="payg">
          <div className="solvapay-checkout-receipt-row">
            <dt>Amount</dt>
            <dd>{formatPrice(meta.amountMinor, meta.currency, { locale })}</dd>
          </div>
          <div className="solvapay-checkout-receipt-row">
            <dt>Credits</dt>
            <dd>+{meta.creditsAdded.toLocaleString(locale)}</dd>
          </div>
          <div className="solvapay-checkout-receipt-row">
            <dt>Plan</dt>
            <dd>{meta.plan.name ?? 'Pay as you go'}</dd>
          </div>
          <div className="solvapay-checkout-receipt-row">
            <dt>Rate</dt>
            <dd>{meta.rateLabel}</dd>
          </div>
        </dl>
      </div>
    )
  }
  return (
    <div className={className ?? 'solvapay-checkout-success'} data-branch="recurring">
      <div className="solvapay-checkout-success-check" aria-hidden="true">
        ✓
      </div>
      <h2 className="solvapay-checkout-success-heading">{meta.plan.name ?? 'Plan'} active</h2>
      <p className="solvapay-checkout-success-subheading">
        Subscription is live and credits are ready.
      </p>
      <dl className="solvapay-checkout-receipt" data-variant="recurring">
        <div className="solvapay-checkout-receipt-row">
          <dt>Plan</dt>
          <dd>{meta.plan.name ?? 'Plan'}</dd>
        </div>
        {meta.creditsIncluded > 0 ? (
          <div className="solvapay-checkout-receipt-row">
            <dt>Credits</dt>
            <dd>+{meta.creditsIncluded.toLocaleString(locale)}</dd>
          </div>
        ) : null}
        <div className="solvapay-checkout-receipt-row">
          <dt>Charged today</dt>
          <dd>{formatPrice(meta.chargedTodayMinor, meta.currency, { locale })}</dd>
        </div>
        {meta.nextRenewalLabel ? (
          <div className="solvapay-checkout-receipt-row">
            <dt>Next renewal</dt>
            <dd>{meta.nextRenewalLabel}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

// Re-export Root with the env-context hooked up so Payment parts can
// read `returnUrl` / `productRef` without prop-drilling.
const RootWithEnv = forwardRef<HTMLDivElement, RootProps>(
  function CheckoutStepsRootWithEnv(props, forwardedRef) {
    const env = useMemo<CheckoutEnvValue>(
      () => ({ returnUrl: props.returnUrl, productRef: props.productRef }),
      [props.returnUrl, props.productRef],
    )
    return (
      <CheckoutEnvContext.Provider value={env}>
        <Root {...props} ref={forwardedRef} />
      </CheckoutEnvContext.Provider>
    )
  },
)

export const CheckoutSteps = {
  Root: RootWithEnv,
  IfStep,
  PlanGrid,
  PlanContinueButton,
  AmountPicker,
  AmountContinueButton,
  Payment,
  BackLink,
  Success,
} as const

export { useCheckoutSteps as useCheckoutStepsContext }

export type { CheckoutStep, SuccessMeta, BootstrapPlanLike } from './shared'
export type { CheckoutStatus } from '../../hooks/useCheckoutFlow'

// Tree-shake-friendly individual exports.
export const CheckoutStepsRoot = RootWithEnv
export const CheckoutStepsIfStep = IfStep
export const CheckoutStepsPlanGrid = PlanGrid
export const CheckoutStepsPlanContinueButton = PlanContinueButton
export const CheckoutStepsAmountPicker = AmountPicker
export const CheckoutStepsAmountContinueButton = AmountContinueButton
export const CheckoutStepsPayment = Payment
export const CheckoutStepsBackLink = BackLink
export const CheckoutStepsSuccess = Success
