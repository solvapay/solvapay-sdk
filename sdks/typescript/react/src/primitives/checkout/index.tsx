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
import type { PaywallStructuredContent } from '@solvapay/server'
import { PlanSelector } from '../PlanSelector'
import {
  AmountPicker as AmountPickerPrimitive,
  useAmountPicker,
  useAmountPickerCopy,
} from '../AmountPicker'
import { PaymentForm } from '../PaymentForm'
import { TopupForm } from '../TopupForm'
import { MandateText } from '../MandateText'
import { isTopupGate, resolvePaywallMessage, usePaywallNoticeOptional } from '../PaywallNotice'
import { Slot } from '../slot'
import { useBalance } from '../../hooks/useBalance'
import { useCopy, useLocale } from '../../hooks/useCopy'
import { useCheckoutFlow, type UseCheckoutFlowReturn } from '../../hooks/useCheckoutFlow'
import { interpolate } from '../../i18n/interpolate'
import type { SolvaPayCopy } from '../../i18n/types'
import { formatPrice } from '../../utils/format'
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
   * Currency for the PAYG topup branch (`AmountPicker`, `TopupForm`,
   * order summary, mandate text). Defaults to `merchant.defaultCurrency`.
   * Pass an explicit value when integrators surface a per-customer
   * currency picker (multi-currency topup, future). Recurring/one-time
   * plans always settle in their own `plan.currency`; this prop only
   * affects the topup branch. Plan currency is **never** used as a
   * fallback for topups — credits are merchant-wide, not plan-specific.
   */
  topupCurrency?: string
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
    topupCurrency,
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
      topupCurrency={topupCurrency}
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
  | 'topupCurrency'
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
  topupCurrency,
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
        topupCurrency={topupCurrency}
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
  | 'topupCurrency'
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
  topupCurrency,
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
    topupCurrency,
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

type StepLeafProps = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  asChild?: boolean
  children?: React.ReactNode
}

/**
 * Step-aware heading rendered at the top of a `<CheckoutSteps.Root>` tree.
 * Reads the active `flow.step` and resolves localized copy:
 *
 *  - `plan` — when nested inside `<PaywallNotice.Root>`, mirrors the
 *    gate-reason heading (`paywall.{paymentRequired,activationRequired,topupRequired}Heading`)
 *    so the entry framing is preserved. Outside paywall context, uses
 *    `checkout.stepHeading.plan` ("Choose your plan").
 *  - `amount` — `checkout.stepHeading.amount` ("Add credits").
 *  - `payment` — `checkout.stepHeading.payment` ("Complete payment").
 *  - `success` — renders nothing; the `<Success>` card owns its own
 *    heading, and a stale "Complete payment" above it would read as a
 *    pending action.
 *
 * Pass `children` to override the resolved text entirely (the consumer
 * stays responsible for keeping their override step-aware).
 */
const StepHeading = forwardRef<HTMLHeadingElement, StepLeafProps>(function CheckoutStepsStepHeading(
  { asChild, children, className, ...rest },
  forwardedRef,
) {
  const flow = useCheckoutContext('StepHeading')
  const copy = useCopy()
  const paywallCtx = usePaywallNoticeOptional()
  if (flow.step === 'success') return null
  const defaultText = resolveStepHeading(flow.step, copy, paywallCtx?.content ?? null)
  const Comp = asChild ? Slot : 'h3'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-checkout-step-heading=""
      data-step={flow.step}
      className={className ?? 'solvapay-checkout-step-heading'}
      {...rest}
    >
      {children ?? defaultText}
    </Comp>
  )
})

/**
 * Step-aware subheading rendered alongside `<StepHeading>`. Resolves
 * branch- and plan-aware copy:
 *
 *  - `plan` inside paywall — defers to `resolvePaywallMessage` so the
 *    structured-balance / product-suffix wording surfaced by the
 *    server is preserved verbatim.
 *  - `plan` outside paywall — `checkout.stepMessage.plan`.
 *  - `amount` — `checkout.stepMessage.amount`.
 *  - `payment` — branch- and plan-shape-aware:
 *    - `payg` -> `paymentPayg`,
 *    - `recurring` with `billingCycle` -> `paymentRecurring`
 *      (interpolates `{planName}`),
 *    - `recurring` without `billingCycle` (one-time / lifetime) ->
 *      `paymentOneTime`.
 *  - `success` — renders nothing.
 */
const StepMessage = forwardRef<HTMLParagraphElement, StepLeafProps>(
  function CheckoutStepsStepMessage({ asChild, children, className, ...rest }, forwardedRef) {
    const flow = useCheckoutContext('StepMessage')
    const copy = useCopy()
    const paywallCtx = usePaywallNoticeOptional()
    if (flow.step === 'success') return null
    const defaultText = resolveStepMessage(flow, copy, paywallCtx?.content ?? null)
    if (!defaultText && children == null) return null
    const Comp = asChild ? Slot : 'p'
    return (
      <Comp
        ref={forwardedRef}
        data-solvapay-checkout-step-message=""
        data-step={flow.step}
        className={className ?? 'solvapay-checkout-step-message'}
        {...rest}
      >
        {children ?? defaultText}
      </Comp>
    )
  },
)

function resolveStepHeading(
  step: CheckoutStep,
  copy: SolvaPayCopy,
  content: PaywallStructuredContent | null,
): string {
  if (step === 'amount') return copy.checkout.stepHeading.amount
  if (step === 'payment') return copy.checkout.stepHeading.payment
  if (step === 'plan') {
    if (content) {
      if (content.kind === 'payment_required') return copy.paywall.paymentRequiredHeading
      if (content.kind === 'activation_required') {
        return isTopupGate(content)
          ? copy.paywall.topupRequiredHeading
          : copy.paywall.activationRequiredHeading
      }
    }
    return copy.checkout.stepHeading.plan
  }
  return ''
}

function resolveStepMessage(
  flow: UseCheckoutFlowReturn,
  copy: SolvaPayCopy,
  content: PaywallStructuredContent | null,
): string {
  if (flow.step === 'plan') {
    if (content) return resolvePaywallMessage(content, copy.paywall)
    return copy.checkout.stepMessage.plan
  }
  if (flow.step === 'amount') return copy.checkout.stepMessage.amount
  if (flow.step === 'payment') {
    if (flow.branch === 'payg') return copy.checkout.stepMessage.paymentPayg
    const plan = flow.selectedPlan
    if (flow.branch === 'recurring' && plan) {
      const planName = plan.name ?? 'your'
      if (plan.billingCycle) {
        return interpolate(copy.checkout.stepMessage.paymentRecurring, { planName })
      }
      return copy.checkout.stepMessage.paymentOneTime
    }
    return copy.checkout.stepMessage.paymentOneTime
  }
  return ''
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
  // Render a skeleton row while the topup currency is unresolved
  // (`useMerchant` still in flight and no explicit `topupCurrency`
  // prop on `<CheckoutSteps.Root>`). Painting USD presets here would
  // mislead a SEK or EUR merchant; the skeleton reads as "loading"
  // and disappears the moment merchant data arrives.
  if (!flow.topupCurrencyReady || flow.topupCurrency == null) {
    return (
      <div className={className ?? 'solvapay-amount-picker'} data-state="loading" aria-busy="true">
        <div className="solvapay-amount-picker-pills">
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              className="solvapay-amount-picker-pill"
              data-state="disabled"
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    )
  }
  return (
    <AmountPickerPrimitive.Root
      currency={flow.topupCurrency}
      emit="minor"
      className={className ?? 'solvapay-amount-picker'}
      onChange={value => {
        if (typeof value === 'number') {
          flow.selectAmount(value)
        }
      }}
    >
      {children ?? <DefaultAmountTree />}
    </AmountPickerPrimitive.Root>
  )
}

// Mirrors the canonical `<AmountPicker>` shim's default tree
// (`packages/react/src/components/AmountPicker.tsx`) so the stepped
// checkout surface matches the hosted topup page: pills row +
// labelled custom row with currency-symbol prefix + credit estimate.
// Inlined rather than importing the shim because the shim mounts its
// own `<Root>` and `<CheckoutSteps>` already owns the flow-driven one.
function DefaultAmountTree() {
  const ctx = useAmountPicker()
  const { selectAmountLabel, customAmountLabel, creditEstimate } = useAmountPickerCopy()
  return (
    <>
      <p className="solvapay-amount-picker-label">{selectAmountLabel}</p>
      <div className="solvapay-amount-picker-pills">
        {ctx.quickAmounts.map(amount => (
          <AmountPickerPrimitive.Option
            key={amount}
            amount={amount}
            className="solvapay-amount-picker-pill"
          />
        ))}
      </div>
      <div className="solvapay-amount-picker-custom-wrapper">
        <p className="solvapay-amount-picker-custom-label">{customAmountLabel}</p>
        <div className="solvapay-amount-picker-custom-row">
          <span className="solvapay-amount-picker-currency-symbol">{ctx.currencySymbol}</span>
          <AmountPickerPrimitive.Custom
            className="solvapay-amount-picker-custom-input"
            placeholder="0.00"
          />
        </div>
      </div>
      <p
        className="solvapay-amount-picker-credit-estimate"
        aria-hidden={ctx.estimatedCredits == null || undefined}
      >
        {ctx.estimatedCredits != null ? creditEstimate(ctx.estimatedCredits) : '\u00a0'}
      </p>
    </>
  )
}

type AmountContinueButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children?: React.ReactNode
}

const AmountContinueButton = forwardRef<HTMLButtonElement, AmountContinueButtonProps>(
  function AmountContinueButton({ className, children, onClick, disabled, ...rest }, ref) {
    const flow = useCheckoutContext('AmountContinueButton')
    const locale = useLocale()
    // Topup currency comes from the merchant (or explicit prop), never
    // from the selected plan — credits are wallet-wide. The sibling
    // `<AmountPicker>` pushes every selection back to the flow via
    // `flow.selectAmount`, so this button only needs to call
    // `flow.advance()`. We deliberately do NOT wrap `<AmountPicker.Confirm>`
    // here — `<CheckoutSteps.AmountPicker>` and `AmountContinueButton`
    // are siblings, so there is no `<AmountPicker.Root>` ancestor in
    // scope and `Confirm` would throw.
    const currency = flow.topupCurrency
    const amountMinor = flow.selectedAmountMinor
    const ready = flow.topupCurrencyReady && currency != null
    const isDisabled = disabled || !ready || amountMinor == null
    const label =
      children ??
      (ready && currency != null && amountMinor != null
        ? `Continue — ${formatPrice(amountMinor, currency, { locale })}`
        : 'Continue')
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
  // Topup currency comes from the merchant (or explicit prop). If it
  // hasn't resolved we cannot mount the Stripe form (it needs a
  // currency to create the topup PI), so render nothing — the
  // `<AmountPicker>` skeleton above keeps the surface non-empty.
  const currency = flow.topupCurrency
  if (!selectedPlanShape || amountMinor == null || currency == null) return null
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
        onSuccess={(intent, extras) => flow.notifyPaymentSuccess(intent, extras)}
      >
        <TopupForm.Loading />
        <TopupForm.BusinessDetails.Root className="solvapay-checkout-business-details">
          <TopupForm.BusinessDetails.Fields />
        </TopupForm.BusinessDetails.Root>
        <TopupForm.Summary.Root className="solvapay-checkout-tax-summary">
          <TopupForm.Summary.Rows />
        </TopupForm.Summary.Root>
        <TopupForm.PaymentElement />
        <TopupForm.Error className="solvapay-checkout-error" />
        <MandateText mode="topup" amountMinor={amountMinor} currency={currency} />
        <span className="solvapay-secure-note">Secure payment processed by Stripe</span>
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
  // Recurring/one-time purchases settle in the *plan's* currency (the
  // amount the merchant priced and Stripe charges). This is correct
  // for plan purchases — distinct from credit topups, which settle
  // into the merchant-wide wallet via `flow.topupCurrency`.
  const currency = (selectedPlanShape.currency ?? 'USD').toUpperCase()
  const amountMinor = selectedPlanShape.price ?? 0
  const cycle = selectedPlanShape.billingCycle
  const planName = selectedPlanShape.name ?? 'Plan'
  // A plan is recurring iff it carries a `billingCycle`. One-time /
  // lifetime plans (no cycle) get `Pay $X` copy + a single-line order
  // summary so they don't read as a subscription.
  const isRecurring = !!cycle
  const formattedAmount = formatPrice(amountMinor, currency, { locale })
  const priceLine = isRecurring ? `${formattedAmount}/${shortCycle(cycle)}` : formattedAmount
  return (
    <div className={className ?? 'solvapay-checkout-payment'} data-branch="recurring">
      <div className="solvapay-checkout-order-summary" data-variant="recurring">
        <div className="solvapay-checkout-order-summary-row">
          <span>{planName}</span>
          <span>{priceLine}</span>
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
        <PaymentForm.BusinessDetails.Root className="solvapay-checkout-business-details">
          <PaymentForm.BusinessDetails.Fields />
        </PaymentForm.BusinessDetails.Root>
        <PaymentForm.TaxSummary.Root className="solvapay-checkout-tax-summary">
          <PaymentForm.TaxSummary.Rows />
        </PaymentForm.TaxSummary.Root>
        <PaymentForm.PaymentElement />
        <PaymentForm.Error className="solvapay-checkout-error" />
        <PaymentForm.MandateText />
        <span className="solvapay-secure-note">Secure payment processed by Stripe</span>
        <PaymentForm.SubmitButton className="solvapay-checkout-pay-button">
          {isRecurring ? `Subscribe — ${priceLine}` : `Pay ${formattedAmount}`}
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
  // `canGoBack` is `true` on amount/payment steps under the default
  // flow; we still gate render on it so a custom flow injected via
  // `<CheckoutSteps.Root flow={…}>` can suppress the link when its
  // own state has no meaningful previous step.
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
  StepHeading,
  StepMessage,
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
export const CheckoutStepsStepHeading = StepHeading
export const CheckoutStepsStepMessage = StepMessage
export const CheckoutStepsPlanGrid = PlanGrid
export const CheckoutStepsPlanContinueButton = PlanContinueButton
export const CheckoutStepsAmountPicker = AmountPicker
export const CheckoutStepsAmountContinueButton = AmountContinueButton
export const CheckoutStepsPayment = Payment
export const CheckoutStepsBackLink = BackLink
export const CheckoutStepsSuccess = Success
