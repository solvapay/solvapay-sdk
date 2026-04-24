'use client'

/**
 * PaymentForm compound primitive.
 *
 * Unstyled, accessible building blocks for running the paid OR free checkout
 * step inside a <SolvaPayProvider>. `Root` detects paid vs free plans via
 * `usePlan`, wires Stripe Elements for paid plans, or falls through to
 * `useActivation` for free plans; both paths expose the same
 * `PaymentFormContext` so the same subcomponents compose identically in
 * either mode.
 *
 * Every leaf accepts `asChild` for Slot-style composition. The `SubmitButton`
 * emits `data-state=idle|processing|disabled` + `data-variant=paid|free|topup|activate`.
 */

import React, {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement as StripePaymentElement,
  CardElement as StripeCardElement,
} from '@stripe/react-stripe-js'
import type { Stripe, StripeElements, StripeElementLocale } from '@stripe/stripe-js'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import { useCheckout } from '../hooks/useCheckout'
import { usePurchase } from '../hooks/usePurchase'
import { useSolvaPay } from '../hooks/useSolvaPay'
import { useCustomer } from '../hooks/useCustomer'
import { useCopy, useLocale } from '../hooks/useCopy'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useActivation } from '../hooks/useActivation'
import { usePlanSelection } from '../components/PlanSelectionContext'
import {
  PaymentFormProvider,
  usePaymentForm,
  type PaymentFormContextValue,
  type PaymentElementKind,
} from '../components/PaymentFormContext'
import { CheckoutSummary as CheckoutSummaryShim } from '../components/CheckoutSummary'
import { MandateText as MandateTextShim } from '../components/MandateText'
import { Spinner } from '../components/Spinner'
import { confirmPayment } from '../utils/confirmPayment'
import { reconcilePayment } from '../utils/processPaymentResult'
import { deriveVariant, type CheckoutVariant } from '../utils/checkoutVariant'
import { resolveCta } from '../utils/checkoutCta'
import { formatPrice } from '../utils/format'
import type {
  ActivationResult,
  PaymentFormProps,
  PaymentResult,
  PrefillCustomer,
  Plan,
} from '../types'

// ---------- helpers ----------

type SubmitDataVariant = 'paid' | 'free' | 'topup' | 'activate'

function toSubmitVariant(variant: CheckoutVariant): SubmitDataVariant {
  switch (variant) {
    case 'freeTier':
      return 'free'
    case 'topup':
      return 'topup'
    case 'usageMetered':
      return 'activate'
    default:
      return 'paid'
  }
}

// ---------- Root ----------

type PaymentFormRootProps = PaymentFormProps & {
  prefillCustomer?: PrefillCustomer
  requireTermsAcceptance?: boolean
  children?: React.ReactNode
}

const Root = forwardRef<HTMLDivElement, PaymentFormRootProps>(function PaymentFormRoot(
  props,
  forwardedRef,
) {
  const {
    planRef,
    productRef,
    onSuccess,
    onResult,
    onFreePlan,
    onError,
    returnUrl,
    submitButtonText,
    className,
    buttonClassName,
    prefillCustomer,
    requireTermsAcceptance = false,
    children,
  } = props

  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('PaymentForm')

  const copy = useCopy()
  const locale = useLocale()
  const planSelection = usePlanSelection()
  const effectivePlanRef = planRef ?? planSelection?.selectedPlanRef ?? undefined
  const effectiveProductRef = productRef ?? planSelection?.productRef

  const { plan: resolvedPlan } = usePlan({
    planRef: effectivePlanRef,
    productRef: effectiveProductRef,
  })
  const isFreePlan = resolvedPlan?.requiresPayment === false

  const {
    loading: checkoutLoading,
    error: checkoutError,
    clientSecret,
    startCheckout,
    stripePromise,
    resolvedPlanRef,
  } = useCheckout({
    planRef: effectivePlanRef,
    productRef: effectiveProductRef,
    customer: prefillCustomer,
  })

  const hasInitializedRef = useRef(false)
  const hasPlanOrProduct = !!(effectivePlanRef || effectiveProductRef)

  useEffect(() => {
    if (isFreePlan) return
    if (
      !hasInitializedRef.current &&
      hasPlanOrProduct &&
      !checkoutLoading &&
      !checkoutError &&
      !clientSecret
    ) {
      hasInitializedRef.current = true
      startCheckout().catch(() => {
        hasInitializedRef.current = false
      })
    }
    if (hasPlanOrProduct && clientSecret) {
      hasInitializedRef.current = true
    }
  }, [
    hasPlanOrProduct,
    checkoutLoading,
    checkoutError,
    clientSecret,
    startCheckout,
    isFreePlan,
  ])

  const finalReturnUrl =
    returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return undefined
    return { clientSecret, locale: locale as StripeElementLocale | undefined }
  }, [clientSecret, locale])

  const shouldRenderElements = !!(stripePromise && clientSecret)

  if (!hasPlanOrProduct) {
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-payment-form=""
        data-state="error"
      >
        <div data-solvapay-payment-form-error="">{copy.errors.configMissingPlanOrProduct}</div>
      </div>
    )
  }

  if (checkoutError) {
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-payment-form=""
        data-state="error"
      >
        <div data-solvapay-payment-form-error="">
          {copy.errors.paymentInitFailed}
          {' '}
          {checkoutError.message || copy.errors.unknownError}
        </div>
      </div>
    )
  }

  if (isFreePlan && resolvedPlan) {
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-payment-form=""
        data-state="ready"
        data-variant="free"
      >
        <FreeInner
          planRef={effectivePlanRef}
          productRef={effectiveProductRef}
          plan={resolvedPlan}
          resolvedPlanRef={resolvedPlanRef}
          requireTermsAcceptance={requireTermsAcceptance}
          submitButtonText={submitButtonText}
          buttonClassName={buttonClassName}
          onFreePlan={onFreePlan}
          onResult={onResult}
          onError={onError}
        >
          {children}
        </FreeInner>
      </div>
    )
  }

  if (shouldRenderElements && elementsOptions) {
    return (
      <div
        ref={forwardedRef}
        className={className}
        data-solvapay-payment-form=""
        data-state="ready"
        data-variant="paid"
      >
        <Elements key={clientSecret!} stripe={stripePromise} options={elementsOptions}>
          <PaidInner
            planRef={effectivePlanRef}
            productRef={effectiveProductRef}
            prefillCustomer={prefillCustomer}
            resolvedPlanRef={resolvedPlanRef}
            plan={resolvedPlan ?? null}
            clientSecret={clientSecret!}
            returnUrl={finalReturnUrl}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
            requireTermsAcceptance={requireTermsAcceptance}
            onSuccess={onSuccess}
            onResult={onResult}
            onError={onError}
          >
            {children}
          </PaidInner>
        </Elements>
      </div>
    )
  }

  return (
    <div
      ref={forwardedRef}
      className={className}
      data-solvapay-payment-form=""
      data-state="loading"
    >
      <div data-solvapay-payment-form-loading="">
        <Spinner size="md" />
      </div>
    </div>
  )
})

// ---------- Paid inner ----------

const PaidInner: React.FC<{
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
  plan: Plan | null
  clientSecret: string
  returnUrl: string
  submitButtonText?: string
  buttonClassName?: string
  requireTermsAcceptance: boolean
  onSuccess?: PaymentFormProps['onSuccess']
  onResult?: PaymentFormProps['onResult']
  onError?: PaymentFormProps['onError']
  children?: React.ReactNode
}> = ({
  planRef,
  productRef,
  prefillCustomer,
  resolvedPlanRef,
  plan,
  clientSecret,
  returnUrl,
  submitButtonText,
  buttonClassName,
  requireTermsAcceptance,
  onSuccess,
  onResult,
  onError,
  children,
}) => {
  const stripe = useStripe()
  const elements = useElements()
  const copy = useCopy()
  const customer = useCustomer()
  const { processPayment } = useSolvaPay()
  const { refetch, hasPaidPurchase } = usePurchase()

  const hasPaidPurchaseRef = useRef(hasPaidPurchase)
  useEffect(() => {
    hasPaidPurchaseRef.current = hasPaidPurchase
  }, [hasPaidPurchase])

  const [elementKind, setElementKind] = useState<PaymentElementKind>(
    children ? null : 'payment-element',
  )
  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReady = !!(stripe && elements)

  const canSubmit =
    isReady &&
    !!clientSecret &&
    !!elementKind &&
    paymentInputComplete &&
    (!requireTermsAcceptance || termsAccepted) &&
    !isProcessing

  const submit = useCallback(async () => {
    if (!stripe || !elements || !clientSecret || !elementKind) {
      const msg =
        !stripe || !elements
          ? copy.errors.stripeUnavailable
          : copy.errors.paymentIntentUnavailable
      setError(msg)
      onError?.(new Error(msg))
      return
    }
    setError(null)
    setIsProcessing(true)

    const result = await confirmPayment({
      stripe: stripe as Stripe,
      elements: elements as StripeElements,
      clientSecret,
      mode: elementKind,
      returnUrl,
      billingDetails: {
        name: customer.name ?? prefillCustomer?.name,
        email: customer.email ?? prefillCustomer?.email,
      },
      copy,
    })

    if (result.status === 'error') {
      setError(result.message)
      setIsProcessing(false)
      onError?.(new Error(result.message))
      return
    }

    if (result.status === 'requires_action' || result.status === 'other') {
      setError(result.message)
      setIsProcessing(false)
      return
    }

    const paymentIntent = result.paymentIntent
    const reconcileResult = await reconcilePayment({
      paymentIntentId: paymentIntent.id as string,
      productRef,
      planRef: planRef || resolvedPlanRef || undefined,
      processPayment,
      refetchPurchase: refetch,
      copy,
    })

    if (reconcileResult.status === 'success') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pi = paymentIntent as any
      onSuccess?.(pi)
      const paid: PaymentResult = { kind: 'paid', paymentIntent: pi }
      onResult?.(paid)

      // Hold isProcessing=true until the provider observes the paid purchase,
      // or a ceiling elapses. Prevents a flicker back to the idle Subscribe
      // button on consumers (e.g. MCP embedded checkout) that gate the view
      // swap on `hasPaidPurchase`. See close_mcp_checkout_success_gap plan.
      const CONFIRMATION_TIMEOUT_MS = 10_000
      const startedAt = Date.now()
      let attempt = 0
      while (
        !hasPaidPurchaseRef.current &&
        Date.now() - startedAt < CONFIRMATION_TIMEOUT_MS
      ) {
        attempt += 1
        await new Promise(r => setTimeout(r, Math.min(500 * attempt, 1500)))
        if (hasPaidPurchaseRef.current) break
        try {
          await refetch()
        } catch {
          // Swallow transient refetch errors; the ceiling will surface a
          // retryable timeout if the purchase never materialises.
        }
      }

      if (!hasPaidPurchaseRef.current) {
        // The backend already confirmed the payment (reconcileResult.status
        // === 'success') — this ceiling only fires when our local purchase
        // snapshot hasn't caught up yet. Use the softer "confirmation
        // delayed" copy instead of the harder "webhooks may not be
        // configured" message, which would blame configuration that is
        // demonstrably working.
        const confirmationMsg = copy.errors.paymentConfirmationDelayed
        setError(confirmationMsg)
        setIsProcessing(false)
        onError?.(new Error(confirmationMsg))
        return
      }

      // Defensive: consumers that gate view on `hasPaidPurchase` typically
      // unmount this form on the same render, so this may never execute.
      setIsProcessing(false)
      return
    }

    setIsProcessing(false)

    const msg =
      reconcileResult.status === 'timeout'
        ? reconcileResult.error.message
        : copy.errors.paymentProcessingFailed
    setError(msg)
    onError?.(reconcileResult.error)
  }, [
    stripe,
    elements,
    clientSecret,
    elementKind,
    returnUrl,
    customer,
    prefillCustomer,
    copy,
    processPayment,
    productRef,
    planRef,
    resolvedPlanRef,
    refetch,
    onSuccess,
    onResult,
    onError,
  ])

  const contextValue: PaymentFormContextValue = useMemo(
    () => ({
      planRef,
      productRef,
      prefillCustomer,
      resolvedPlanRef,
      plan,
      clientSecret,
      stripe: (stripe as Stripe | null) ?? null,
      elements: (elements as StripeElements | null) ?? null,
      isProcessing,
      isReady,
      paymentInputComplete,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error,
      elementKind,
      returnUrl,
      submitButtonText,
      buttonClassName,
      setElementKind,
      setPaymentInputComplete,
      setTermsAccepted,
      submit,
    }),
    [
      planRef,
      productRef,
      prefillCustomer,
      resolvedPlanRef,
      plan,
      clientSecret,
      stripe,
      elements,
      isProcessing,
      isReady,
      paymentInputComplete,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error,
      elementKind,
      returnUrl,
      submitButtonText,
      buttonClassName,
      submit,
    ],
  )

  return <PaymentFormProvider value={contextValue}>{children}</PaymentFormProvider>
}

// ---------- Free inner ----------

const FreeInner: React.FC<{
  planRef?: string
  productRef?: string
  plan: Plan
  resolvedPlanRef: string | null
  requireTermsAcceptance: boolean
  submitButtonText?: string
  buttonClassName?: string
  onFreePlan?: PaymentFormProps['onFreePlan']
  onResult?: PaymentFormProps['onResult']
  onError?: PaymentFormProps['onError']
  children?: React.ReactNode
}> = ({
  planRef,
  productRef,
  plan,
  resolvedPlanRef,
  requireTermsAcceptance,
  submitButtonText,
  buttonClassName,
  onFreePlan,
  onResult,
  onError,
  children,
}) => {
  const copy = useCopy()
  const { refetch } = usePurchase()
  const { activate, state, error: activationError, result: activationResult } = useActivation()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const resultFiredRef = useRef(false)

  useEffect(() => {
    if (state === 'activated' && activationResult && !resultFiredRef.current) {
      resultFiredRef.current = true
      const res: ActivationResult = { kind: 'activated', result: activationResult }
      onResult?.(res)
      refetch().catch(() => {
        // refetch errors are non-fatal for activation success
      })
    }
  }, [state, activationResult, onResult, refetch])

  const isProcessing = state === 'activating'
  const canSubmit =
    !isProcessing && (!requireTermsAcceptance || termsAccepted) && !!productRef

  const submit = useCallback(async () => {
    if (!productRef) {
      const msg = copy.errors.configMissingPlanOrProduct
      setLocalError(msg)
      onError?.(new Error(msg))
      return
    }
    setLocalError(null)
    try {
      if (onFreePlan) {
        await onFreePlan(plan)
        onResult?.({
          kind: 'activated',
          result: {
            status: 'activated',
            productRef,
            planRef: plan.reference,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        })
        return
      }
      await activate({ productRef, planRef: plan.reference })
    } catch (err) {
      const msg = err instanceof Error ? err.message : copy.activation.failed
      setLocalError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    }
  }, [productRef, plan, onFreePlan, activate, onResult, onError, copy])

  const error = localError ?? activationError

  const contextValue: PaymentFormContextValue = useMemo(
    () => ({
      planRef,
      productRef,
      prefillCustomer: undefined,
      resolvedPlanRef,
      plan,
      clientSecret: null,
      stripe: null,
      elements: null,
      isProcessing,
      isReady: true,
      paymentInputComplete: true,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error,
      elementKind: null,
      returnUrl: '',
      submitButtonText,
      buttonClassName,
      setElementKind: () => {},
      setPaymentInputComplete: () => {},
      setTermsAccepted,
      submit,
    }),
    [
      planRef,
      productRef,
      resolvedPlanRef,
      plan,
      isProcessing,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error,
      submitButtonText,
      buttonClassName,
      submit,
    ],
  )

  return <PaymentFormProvider value={contextValue}>{children}</PaymentFormProvider>
}

// ---------- Subcomponents ----------

type SummaryProps = Omit<
  React.ComponentProps<typeof CheckoutSummaryShim>,
  'planRef' | 'productRef'
>

const Summary: React.FC<SummaryProps> = props => {
  const ctx = usePaymentForm()
  return (
    <CheckoutSummaryShim
      {...props}
      planRef={ctx.planRef || ctx.resolvedPlanRef || undefined}
      productRef={ctx.productRef}
    />
  )
}

type MandateTextPrimitiveProps = Omit<
  React.ComponentProps<typeof MandateTextShim>,
  'planRef' | 'productRef'
>

const MandateTextPrimitive: React.FC<MandateTextPrimitiveProps> = props => {
  const ctx = usePaymentForm()
  return (
    <MandateTextShim
      {...props}
      planRef={ctx.planRef || ctx.resolvedPlanRef || undefined}
      productRef={ctx.productRef}
    />
  )
}

type CustomerFieldsProps = React.HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean
  readOnly?: boolean
}

const CustomerFields = forwardRef<HTMLDivElement, CustomerFieldsProps>(
  function PaymentFormCustomerFields({ asChild, readOnly: _readOnly = true, children, ...rest }, ref) {
    const copy = useCopy()
    const customer = useCustomer()
    const { prefillCustomer } = usePaymentForm()

    const email = customer.email ?? prefillCustomer?.email
    const name = customer.name ?? prefillCustomer?.name

    if (!email && !name) return null

    const Comp = asChild ? Slot : 'div'
    return (
      <Comp ref={ref} data-solvapay-payment-form-customer-fields="" {...rest}>
        {children ?? (
          <>
            {email && (
              <div data-solvapay-payment-form-customer-email="">
                <span>{copy.customer.emailLabel}: </span>
                <span>{email}</span>
              </div>
            )}
            {name && (
              <div data-solvapay-payment-form-customer-name="">
                <span>{copy.customer.nameLabel}: </span>
                <span>{name}</span>
              </div>
            )}
          </>
        )}
      </Comp>
    )
  },
)

type PaymentElementProps = {
  options?: React.ComponentProps<typeof StripePaymentElement>['options']
}

const PaymentElementSlot: React.FC<PaymentElementProps> = ({ options }) => {
  const { setElementKind, setPaymentInputComplete, isReady, stripe, elements } = usePaymentForm()
  const locale = useLocale()

  useEffect(() => {
    if (stripe && elements) setElementKind('payment-element')
  }, [setElementKind, stripe, elements])

  if (!stripe || !elements) return null

  if (!isReady) {
    return (
      <div data-solvapay-payment-form-loading="">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div data-solvapay-payment-form-payment-element="">
      <StripePaymentElement
        options={options}
        onChange={e => setPaymentInputComplete(e.complete)}
        key={locale || 'default'}
      />
    </div>
  )
}

type CardElementProps = {
  options?: React.ComponentProps<typeof StripeCardElement>['options']
}

const CardElementSlot: React.FC<CardElementProps> = ({ options }) => {
  const { setElementKind, setPaymentInputComplete, isReady, stripe, elements } = usePaymentForm()

  useEffect(() => {
    if (stripe && elements) setElementKind('card-element')
  }, [setElementKind, stripe, elements])

  if (!stripe || !elements) return null

  if (!isReady) {
    return (
      <div data-solvapay-payment-form-loading="">
        <Spinner size="sm" />
      </div>
    )
  }

  return (
    <div data-solvapay-payment-form-card-element="">
      <StripeCardElement
        options={options}
        onChange={e => setPaymentInputComplete(e.complete)}
      />
    </div>
  )
}

type TermsCheckboxProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  asChild?: boolean
  label?: React.ReactNode
}

const TermsCheckbox = forwardRef<HTMLLabelElement, TermsCheckboxProps>(
  function PaymentFormTermsCheckbox({ asChild, label, children, ...rest }, ref) {
    const { termsAccepted, setTermsAccepted } = usePaymentForm()
    const copy = useCopy()
    const id = 'solvapay-terms-checkbox'

    if (asChild) {
      return (
        <Slot ref={ref} data-solvapay-payment-form-terms="" {...rest}>
          {children}
        </Slot>
      )
    }
    return (
      <label
        ref={ref}
        htmlFor={id}
        data-solvapay-payment-form-terms=""
        {...rest}
      >
        <input
          id={id}
          type="checkbox"
          checked={termsAccepted}
          onChange={e => setTermsAccepted(e.target.checked)}
        />
        <span>{label ?? copy.terms.checkboxLabel}</span>
      </label>
    )
  },
)

type SubmitButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(
  function PaymentFormSubmitButton({ asChild, onClick, children, ...rest }, ref) {
    const ctx = usePaymentForm()
    const copy = useCopy()
    const locale = useLocale()
    const { plan } = usePlan({
      planRef: ctx.planRef || ctx.resolvedPlanRef || undefined,
      productRef: ctx.productRef,
    })
    const { product } = useProduct(ctx.productRef)

    const variant = deriveVariant(plan ?? ctx.plan ?? undefined)
    const dataVariant = toSubmitVariant(variant)
    const dataState: 'idle' | 'processing' | 'disabled' = ctx.isProcessing
      ? 'processing'
      : !ctx.canSubmit
        ? 'disabled'
        : 'idle'

    const amountFormatted = formatPrice(
      plan?.price ?? ctx.plan?.price ?? 0,
      plan?.currency ?? ctx.plan?.currency ?? 'usd',
      { locale, free: copy.interval.free },
    )

    const label = resolveCta({
      variant,
      plan: plan ?? ctx.plan,
      product,
      amountFormatted,
      copy,
      override: typeof children === 'string' ? children : ctx.submitButtonText,
    })

    const content = ctx.isProcessing ? (
      <>
        <Spinner size="sm" />
        <span>{copy.cta.processing}</span>
      </>
    ) : children && typeof children !== 'string' ? (
      children
    ) : (
      label
    )

    const buttonProps = {
      'data-solvapay-payment-form-submit': '',
      'data-state': dataState,
      'data-variant': dataVariant,
      'aria-busy': ctx.isProcessing,
      'aria-disabled': !ctx.canSubmit,
      'aria-label': label,
      disabled: !ctx.canSubmit,
      className: rest.className ?? ctx.buttonClassName,
      onClick: composeEventHandlers(onClick, e => {
        e.preventDefault()
        ctx.submit()
      }),
      ...rest,
    } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={ref as any} {...(buttonProps as Record<string, unknown>)}>
          {content}
        </Slot>
      )
    }
    return (
      <button ref={ref} type="submit" {...buttonProps}>
        {content}
      </button>
    )
  },
)

type LoadingProps = React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }

const Loading = forwardRef<HTMLDivElement, LoadingProps>(function PaymentFormLoading(
  { asChild, children, ...rest },
  ref,
) {
  const ctx = usePaymentForm()
  if (ctx.isReady && ctx.clientSecret) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={ref} data-solvapay-payment-form-loading="" {...rest}>
      {children ?? <Spinner size="sm" />}
    </Comp>
  )
})

type ErrorProps = React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }

const ErrorSlot = forwardRef<HTMLDivElement, ErrorProps>(function PaymentFormError(
  { asChild, children, ...rest },
  ref,
) {
  const ctx = usePaymentForm()
  if (!ctx.error) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={ref}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-solvapay-payment-form-error=""
      {...rest}
    >
      {children ?? ctx.error}
    </Comp>
  )
})

// ---------- Exports ----------

export const PaymentFormRoot = Root
export const PaymentFormSummary = Summary
export const PaymentFormCustomerFields = CustomerFields
export const PaymentFormPaymentElement = PaymentElementSlot
export const PaymentFormCardElement = CardElementSlot
export const PaymentFormMandateText = MandateTextPrimitive
export const PaymentFormTermsCheckbox = TermsCheckbox
export const PaymentFormSubmitButton = SubmitButton
export const PaymentFormLoading = Loading
export const PaymentFormError = ErrorSlot

export const PaymentForm = {
  Root,
  Summary,
  CustomerFields,
  PaymentElement: PaymentElementSlot,
  CardElement: CardElementSlot,
  MandateText: MandateTextPrimitive,
  TermsCheckbox,
  SubmitButton,
  Loading,
  Error: ErrorSlot,
} as const
