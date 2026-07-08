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
import { LegalFooter } from './LegalFooter'
import { withPaymentElementDefaults } from './paymentElementDefaults'
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
import {
  readPaymentIntentClientSecret,
  stripPaymentIntentParams,
} from './paymentIntentReturn'
import { normalizeOneTimePurchase } from '../utils/normalizePurchase'
import { deriveVariant, type CheckoutVariant } from '../utils/checkoutVariant'
import { resolveCta } from '../utils/checkoutCta'
import { formatPrice } from '../utils/format'
import {
  useBusinessDetailsAttach,
  defaultBusinessDetails,
} from '../hooks/useBusinessDetailsAttach'
import {
  createBusinessDetailsParts,
  createTaxSummaryParts,
} from '../components/businessCheckoutParts'
import type {
  ActivationResult,
  PaymentFormProps,
  PaymentResult,
  PrefillCustomer,
  Plan,
} from '../types'
import type { ActivatePlanResult } from '@solvapay/server'

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

const Root = forwardRef<HTMLElement, PaymentFormRootProps>(
  function PaymentFormRoot(props, forwardedRef) {
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

    const { attachBusinessDetails, customerRef } = solva

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
      processorPaymentId,
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
    }, [hasPlanOrProduct, checkoutLoading, checkoutError, clientSecret, startCheckout, isFreePlan])

    const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

    const elementsOptions = useMemo(() => {
      if (!clientSecret) return undefined
      return { clientSecret, locale: locale as StripeElementLocale | undefined }
    }, [clientSecret, locale])

    const shouldRenderElements = !!(stripePromise && clientSecret)

    if (!hasPlanOrProduct) {
      return (
        <section
          ref={forwardedRef}
          className={className}
          data-solvapay-payment-form=""
          data-state="error"
        >
          <p role="alert" data-solvapay-payment-form-error="">
            {copy.errors.configMissingPlanOrProduct}
          </p>
        </section>
      )
    }

    if (checkoutError) {
      return (
        <section
          ref={forwardedRef}
          className={className}
          data-solvapay-payment-form=""
          data-state="error"
        >
          <p role="alert" data-solvapay-payment-form-error="">
            {copy.errors.paymentInitFailed} {checkoutError.message || copy.errors.unknownError}
          </p>
        </section>
      )
    }

    if (isFreePlan && resolvedPlan) {
      return (
        <section
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
        </section>
      )
    }

    if (shouldRenderElements && elementsOptions) {
      return (
        <section
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
              processorPaymentId={processorPaymentId}
              returnUrl={finalReturnUrl}
              submitButtonText={submitButtonText}
              buttonClassName={buttonClassName}
              requireTermsAcceptance={requireTermsAcceptance}
              onSuccess={onSuccess}
              onResult={onResult}
              onError={onError}
              onTaxChange={props.onTaxChange}
              attachBusinessDetails={attachBusinessDetails}
              customerRef={customerRef}
            >
              {children}
            </PaidInner>
          </Elements>
        </section>
      )
    }

    return (
      <section
        ref={forwardedRef}
        className={className}
        data-solvapay-payment-form=""
        data-state="loading"
      >
        <output data-solvapay-payment-form-loading="">
          <Spinner size="md" />
        </output>
      </section>
    )
  },
)

// ---------- Paid inner ----------

const PaidInner: React.FC<{
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
  plan: Plan | null
  clientSecret: string
  processorPaymentId: string | null
  returnUrl: string
  submitButtonText?: string
  buttonClassName?: string
  requireTermsAcceptance: boolean
  onSuccess?: PaymentFormProps['onSuccess']
  onResult?: PaymentFormProps['onResult']
  onError?: PaymentFormProps['onError']
  onTaxChange?: PaymentFormProps['onTaxChange']
  attachBusinessDetails?: (params: {
    paymentIntentId: string
    customerRef?: string
    isBusiness: boolean
    businessName?: string
    country?: string
    taxId?: string
    taxIdType?: import('@solvapay/core').TaxIdType
  }) => Promise<{ taxBreakdown: import('@solvapay/core').TaxBreakdown }>
  customerRef?: string
  children?: React.ReactNode
}> = ({
  planRef,
  productRef,
  prefillCustomer,
  resolvedPlanRef,
  plan,
  clientSecret,
  processorPaymentId,
  returnUrl,
  submitButtonText,
  buttonClassName,
  requireTermsAcceptance,
  onSuccess,
  onResult,
  onError,
  onTaxChange,
  attachBusinessDetails,
  customerRef,
  children,
}) => {
  const stripe = useStripe()
  const elements = useElements()
  const copy = useCopy()
  const customer = useCustomer()
  const { processPayment, upsertPurchase } = useSolvaPay()
  const { refetch } = usePurchase()

  const refreshElements = useCallback(async () => {
    if (elements) {
      await elements.fetchUpdates()
    }
  }, [elements])

  const {
    businessDetails,
    setBusinessDetails,
    fieldErrors,
    taxBreakdown,
    businessDetailsAttached,
    businessDetailsAttaching,
    businessDetailsError,
    requiresBusinessAttach,
    runAttach,
  } = useBusinessDetailsAttach({
    processorPaymentId,
    attachBusinessDetails,
    customerRef,
    onTaxChange,
    refreshElements,
  })

  const [elementKind, setElementKind] = useState<PaymentElementKind>(
    children ? null : 'payment-element',
  )
  const [paymentInputComplete, setPaymentInputComplete] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const returnResumeStarted = useRef(false)

  useEffect(() => {
    if (!stripe || returnResumeStarted.current || typeof window === 'undefined') return
    const returnClientSecret = readPaymentIntentClientSecret(window.location.search)
    if (!returnClientSecret) return
    returnResumeStarted.current = true

    let cancelled = false
    void (async () => {
      setIsProcessing(true)
      setError(undefined)

      const retrieved = await stripe.retrievePaymentIntent(returnClientSecret)
      if (cancelled) return
      stripPaymentIntentParams()

      if (retrieved.error || !retrieved.paymentIntent) {
        setError(copy.errors.paymentUnexpected)
        setIsProcessing(false)
        return
      }

      let paymentIntent = retrieved.paymentIntent
      if (paymentIntent.status === 'requires_action') {
        const actionResult = await stripe.handleNextAction({ clientSecret: returnClientSecret })
        if (cancelled) return
        if (actionResult.error || !actionResult.paymentIntent) {
          setError(copy.errors.paymentRequires3ds)
          setIsProcessing(false)
          return
        }
        paymentIntent = actionResult.paymentIntent
      }

      if (paymentIntent.status === 'processing') {
        setError(copy.errors.paymentPending)
        setIsProcessing(false)
        return
      }

      if (paymentIntent.status !== 'succeeded') {
        setError(copy.errors.paymentProcessingFailed)
        setIsProcessing(false)
        return
      }

      const reconcileResult = await reconcilePayment({
        paymentIntentId: paymentIntent.id,
        productRef,
        planRef: planRef || resolvedPlanRef || undefined,
        processPayment,
        refetchPurchase: refetch,
        copy,
      })

      if (cancelled) return

      if (reconcileResult.status === 'success') {
        const r = reconcileResult.result
        if (r && 'type' in r && r.type === 'recurring') {
          upsertPurchase(r.purchase)
        } else if (r && 'type' in r && r.type === 'one-time') {
          upsertPurchase(normalizeOneTimePurchase(r.oneTimePurchase))
        } else {
          try {
            await refetch()
          } catch (error) {
            console.error('[PaymentForm] secondary purchase refetch failed after return-path success', error)
          }
        }
        onSuccess?.(paymentIntent)
        onResult?.({ kind: 'paid', paymentIntent })
        setIsProcessing(false)
        return
      }

      const msg =
        reconcileResult.status === 'timeout' || reconcileResult.status === 'pending'
          ? reconcileResult.error.message
          : copy.errors.paymentProcessingFailed
      setError(msg)
      onError?.(reconcileResult.error)
      setIsProcessing(false)
    })()

    return () => {
      cancelled = true
    }
  }, [
    stripe,
    copy,
    productRef,
    planRef,
    resolvedPlanRef,
    processPayment,
    refetch,
    upsertPurchase,
    onSuccess,
    onResult,
    onError,
  ])

  const isReady = !!(stripe && elements)

  const canSubmit =
    isReady &&
    !!clientSecret &&
    !!elementKind &&
    paymentInputComplete &&
    (!requireTermsAcceptance || termsAccepted) &&
    (!requiresBusinessAttach || businessDetailsAttached) &&
    !businessDetailsAttaching &&
    !isProcessing

  const submit = useCallback(async () => {
    if (!stripe || !elements || !clientSecret || !elementKind) {
      const msg =
        !stripe || !elements ? copy.errors.stripeUnavailable : copy.errors.paymentIntentUnavailable
      setError(msg)
      onError?.(new Error(msg))
      return
    }
    if (requiresBusinessAttach && !businessDetailsAttached) {
      const attached = await runAttach(businessDetails)
      if (!attached) {
        const msg = businessDetailsError ?? 'Complete business details before paying'
        setError(msg)
        onError?.(new Error(msg))
        return
      }
    }

    setError(undefined)
    setIsProcessing(true)

    // Wrap the entire post-`setIsProcessing(true)` block in try/finally so
    // any thrown error in confirmPayment, reconcilePayment, upsertPurchase,
    // or onSuccess/onResult can't wedge the button in the processing state.
    // The previous fire-and-forget submit() returned a rejected promise on
    // an unexpected backend shape (e.g. bare `{ status: 'succeeded' }`
    // hitting `normalizeOneTimePurchase(undefined)`) and the caller never
    // re-enabled the button. The `try/finally` is the actual fix for the
    // stuck button — the `'type' in r` guard below stops the specific
    // current crash, but future contract drift can't wedge the form.
    try {
      const result = await confirmPayment({
        stripe: stripe as Stripe,
        elements: elements as StripeElements,
        clientSecret,
        mode: elementKind === 'card-element' ? 'card-element' : 'payment-element',
        returnUrl,
        billingDetails: {
          name: customer.name ?? prefillCustomer?.name,
          email: customer.email ?? prefillCustomer?.email,
        },
        copy,
      })

      if (result.status === 'error') {
        setError(result.message)
        onError?.(new Error(result.message))
        return
      }

      if (result.status === 'requires_action' || result.status === 'other') {
        setError(result.message)
        return
      }

      if (result.status === 'pending') {
        setError(result.message)
        return
      }

      const reconcileResult = await reconcilePayment({
        paymentIntentId: result.paymentIntent.id,
        productRef,
        planRef: planRef || resolvedPlanRef || undefined,
        processPayment,
        refetchPurchase: refetch,
        copy,
      })

      if (reconcileResult.status === 'success') {
        // Synchronously merge the authoritative purchase from
        // `processPaymentIntent` into provider state so consumers that
        // gate on `hasPaidPurchase` / `activePurchase` see the new row on
        // the same render this form unmounts. No flicker, no post-confirm
        // polling loop. The backend invariant (webhook handler finalizes
        // BEFORE flipping PI.status to 'succeeded') makes the bare
        // `{ status: 'succeeded' }` shape unreachable in normal operation —
        // we keep this branch as belt-and-braces defensive refetch for
        // resilience against backend invariant violations and for the
        // legacy `!processPayment` compat path.
        const r = reconcileResult.result
        if (r && 'type' in r && r.type === 'recurring') {
          upsertPurchase(r.purchase)
        } else if (r && 'type' in r && r.type === 'one-time') {
          upsertPurchase(normalizeOneTimePurchase(r.oneTimePurchase))
        } else {
          try {
            await refetch()
          } catch (error) {
            console.error('[PaymentForm] secondary purchase refetch failed after submit success', error)
          }
        }

        onSuccess?.(result.paymentIntent)
        const paid: PaymentResult = { kind: 'paid', paymentIntent: result.paymentIntent }
        onResult?.(paid)
        return
      }

      const msg =
        reconcileResult.status === 'timeout' || reconcileResult.status === 'pending'
          ? reconcileResult.error.message
          : copy.errors.paymentProcessingFailed
      setError(msg)
      onError?.(reconcileResult.error)
    } finally {
      setIsProcessing(false)
    }
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
    upsertPurchase,
    onSuccess,
    onResult,
    onError,
    requiresBusinessAttach,
    businessDetailsAttached,
    runAttach,
    businessDetails,
    businessDetailsError,
  ])

  const effectiveError = error ?? businessDetailsError

  const contextValue: PaymentFormContextValue = useMemo(
    () => ({
      planRef,
      productRef,
      prefillCustomer,
      resolvedPlanRef,
      plan,
      clientSecret,
      processorPaymentId,
      stripe: (stripe as Stripe | null) ?? null,
      elements: (elements as StripeElements | null) ?? null,
      isProcessing,
      isReady,
      paymentInputComplete,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      error: effectiveError ?? null,
      elementKind,
      returnUrl,
      submitButtonText,
      buttonClassName,
      businessDetails,
      taxBreakdown,
      businessDetailsAttached,
      businessDetailsAttaching,
      businessDetailsError,
      fieldErrors,
      setBusinessDetails,
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
      processorPaymentId,
      stripe,
      elements,
      isProcessing,
      isReady,
      paymentInputComplete,
      termsAccepted,
      requireTermsAcceptance,
      canSubmit,
      effectiveError,
      elementKind,
      returnUrl,
      submitButtonText,
      buttonClassName,
      businessDetails,
      taxBreakdown,
      businessDetailsAttached,
      businessDetailsAttaching,
      businessDetailsError,
      fieldErrors,
      setBusinessDetails,
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
  const [localError, setLocalError] = useState<string | undefined>(undefined)
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
  const canSubmit = !isProcessing && (!requireTermsAcceptance || termsAccepted) && !!productRef

  const submit = useCallback(async () => {
    if (!productRef) {
      const msg = copy.errors.configMissingPlanOrProduct
      setLocalError(msg)
      onError?.(new Error(msg))
      return
    }
    setLocalError(undefined)
    try {
      if (onFreePlan) {
        await onFreePlan(plan)
        const activationResult: ActivatePlanResult = { status: 'activated' }
        const activated: ActivationResult = { kind: 'activated', result: activationResult }
        onResult?.(activated)
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
      processorPaymentId: null,
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
      businessDetails: defaultBusinessDetails,
      taxBreakdown: null,
      businessDetailsAttached: false,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      fieldErrors: {},
      setBusinessDetails: () => {},
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

type SummaryProps = Omit<React.ComponentProps<typeof CheckoutSummaryShim>, 'planRef' | 'productRef'>

const Summary: React.FC<SummaryProps> = props => {
  const ctx = usePaymentForm()
  return (
    <CheckoutSummaryShim
      {...props}
      planRef={ctx.planRef || ctx.resolvedPlanRef || undefined}
      productRef={ctx.productRef}
      taxBreakdown={ctx.taxBreakdown}
      baseAmountMinor={ctx.plan?.price ?? 0}
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

type CustomerFieldsProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean
  readOnly?: boolean
}

const CustomerFields = forwardRef<HTMLElement, CustomerFieldsProps>(
  function PaymentFormCustomerFields(
    { asChild, readOnly: _readOnly = true, children, ...rest },
    ref,
  ) {
    const copy = useCopy()
    const customer = useCustomer()
    const { prefillCustomer } = usePaymentForm()

    const email = customer.email ?? prefillCustomer?.email
    const name = customer.name ?? prefillCustomer?.name

    if (!email && !name) return null

    const Comp = asChild ? Slot : 'section'
    return (
      <Comp ref={ref} data-solvapay-payment-form-customer-fields="" {...rest}>
        {children ?? (
          <>
            {email && (
              <dl data-solvapay-payment-form-customer-email="">
                <dt>{copy.customer.emailLabel}</dt>
                <dd>{email}</dd>
              </dl>
            )}
            {name && (
              <dl data-solvapay-payment-form-customer-name="">
                <dt>{copy.customer.nameLabel}</dt>
                <dd>{name}</dd>
              </dl>
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
      <output data-solvapay-payment-form-loading="">
        <Spinner size="sm" />
      </output>
    )
  }

  return (
    <section data-solvapay-payment-form-payment-element="">
      <StripePaymentElement
        options={withPaymentElementDefaults(options)}
        onChange={e => setPaymentInputComplete(e.complete)}
        key={locale || 'default'}
      />
    </section>
  )
}

type CardElementProps = {
  options?: React.ComponentProps<typeof StripeCardElement>['options']
}

/**
 * @deprecated Use `PaymentForm.PaymentElement` instead. Slated for removal in
 * the next major release.
 */
const CardElementSlot: React.FC<CardElementProps> = ({ options }) => {
  const { setElementKind, setPaymentInputComplete, isReady, stripe, elements } = usePaymentForm()

  useEffect(() => {
    if (stripe && elements) setElementKind('card-element')
  }, [setElementKind, stripe, elements])

  if (!stripe || !elements) return null

  if (!isReady) {
    return (
      <output data-solvapay-payment-form-loading="">
        <Spinner size="sm" />
      </output>
    )
  }

  return (
    <section data-solvapay-payment-form-card-element="">
      <StripeCardElement options={options} onChange={e => setPaymentInputComplete(e.complete)} />
    </section>
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
      <label ref={ref} htmlFor={id} data-solvapay-payment-form-terms="" {...rest}>
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

    const planCurrency = plan?.currency ?? ctx.plan?.currency ?? 'usd'
    const baseMinor = ctx.taxBreakdown?.total ?? plan?.price ?? ctx.plan?.price ?? 0
    const amountFormatted = formatPrice(baseMinor, ctx.taxBreakdown?.currency ?? planCurrency, {
      locale,
      interval: variant === 'recurring' ? plan?.interval ?? ctx.plan?.interval : undefined,
      intervalCount: variant === 'recurring' ? 1 : undefined,
      free: copy.interval.free,
    })

    const label = resolveCta({
      variant,
      plan: plan ?? ctx.plan,
      product,
      amountFormatted,
      copy,
      override: typeof children === 'string' ? children : ctx.submitButtonText,
    })

    const processingContent = (
      <>
        <Spinner size="sm" />
        <span>{copy.cta.processing}</span>
      </>
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
      // Preserve the consumer's wrapper element across idle→processing.
      // See the matching comment in TopupForm.SubmitButton — replacing
      // the wrapper with a Fragment when processing strips className,
      // disabled, and onClick from the rendered DOM.
      const slotChild =
        ctx.isProcessing && React.isValidElement(children)
          ? React.cloneElement(
              children as React.ReactElement<{ children?: React.ReactNode }>,
              undefined,
              processingContent,
            )
          : children
      return (
        <Slot ref={ref as React.Ref<HTMLElement>} {...(buttonProps as Record<string, unknown>)}>
          {slotChild}
        </Slot>
      )
    }

    const content = ctx.isProcessing
      ? processingContent
      : children && typeof children !== 'string'
        ? children
        : label

    return (
      <button ref={ref} type="submit" {...buttonProps}>
        {content}
      </button>
    )
  },
)

type LoadingProps = React.HTMLAttributes<HTMLOutputElement> & { asChild?: boolean }

const Loading = forwardRef<HTMLOutputElement, LoadingProps>(function PaymentFormLoading(
  { asChild, children, ...rest },
  ref,
) {
  const ctx = usePaymentForm()
  if (ctx.isReady && ctx.clientSecret) return null
  if (asChild) {
    return (
      <Slot ref={ref as React.Ref<HTMLElement>} data-solvapay-payment-form-loading="" {...rest}>
        {children ?? <Spinner size="sm" />}
      </Slot>
    )
  }
  return (
    <output ref={ref} data-solvapay-payment-form-loading="" {...rest}>
      {children ?? <Spinner size="sm" />}
    </output>
  )
})

type ErrorProps = React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }

const ErrorSlot = forwardRef<HTMLParagraphElement, ErrorProps>(function PaymentFormError(
  { asChild, children, ...rest },
  ref,
) {
  const ctx = usePaymentForm()
  if (!ctx.error) return null
  if (asChild) {
    return (
      <Slot
        ref={ref as React.Ref<HTMLElement>}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-solvapay-payment-form-error=""
        {...rest}
      >
        {children ?? ctx.error}
      </Slot>
    )
  }
  return (
    <p
      ref={ref}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-solvapay-payment-form-error=""
      {...rest}
    >
      {children ?? ctx.error}
    </p>
  )
})

function usePaymentBusinessCtx(_part: string) {
  const ctx = usePaymentForm()
  return {
    businessDetails: ctx.businessDetails,
    setBusinessDetails: ctx.setBusinessDetails,
    fieldErrors: ctx.fieldErrors,
  }
}

function usePaymentSummaryCtx(_part: string) {
  const ctx = usePaymentForm()
  return {
    taxBreakdown: ctx.taxBreakdown,
    businessDetailsAttaching: ctx.businessDetailsAttaching,
    baseAmountMinor: ctx.plan?.price ?? 0,
    currency: ctx.taxBreakdown?.currency ?? ctx.plan?.currency ?? 'usd',
  }
}

const BusinessDetails = createBusinessDetailsParts(usePaymentBusinessCtx, 'payment-form')
const TaxSummary = createTaxSummaryParts(usePaymentSummaryCtx, 'payment-form')

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
export const PaymentFormLegalFooter = LegalFooter
export const PaymentFormBusinessDetails = BusinessDetails
export const PaymentFormTaxSummary = TaxSummary

export const PaymentForm = {
  Root,
  Summary,
  CustomerFields,
  PaymentElement: PaymentElementSlot,
  CardElement: CardElementSlot,
  BusinessDetails,
  TaxSummary,
  MandateText: MandateTextPrimitive,
  TermsCheckbox,
  SubmitButton,
  Loading,
  Error: ErrorSlot,
  LegalFooter,
} as const
