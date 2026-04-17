'use client'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Elements, useStripe, useElements } from '@stripe/react-stripe-js'
import type { Stripe, StripeElements, StripeElementLocale } from '@stripe/stripe-js'
import { useCheckout } from './hooks/useCheckout'
import { usePurchase } from './hooks/usePurchase'
import { useSolvaPay } from './hooks/useSolvaPay'
import { useCustomer } from './hooks/useCustomer'
import { useCopy, useLocale } from './hooks/useCopy'
import { usePlan } from './hooks/usePlan'
import { useActivation } from './hooks/useActivation'
import { Spinner } from './components/Spinner'
import { CheckoutSummary } from './components/CheckoutSummary'
import { MandateText } from './components/MandateText'
import { interpolate } from './i18n/interpolate'
import {
  PaymentFormProvider,
  type PaymentElementKind,
  type PaymentFormContextValue,
} from './components/PaymentFormContext'
import { usePlanSelection } from './components/PlanSelectionContext'
import {
  PaymentFormSummary,
  PaymentFormCustomerFields,
  PaymentFormPaymentElement,
  PaymentFormCardElement,
  PaymentFormMandateText,
  PaymentFormTermsCheckbox,
  PaymentFormSubmitButton,
  PaymentFormError,
} from './components/PaymentFormSlots'
import { confirmPayment } from './utils/confirmPayment'
import { reconcilePayment } from './utils/processPaymentResult'
import type {
  ActivationResult,
  PaymentFormProps,
  PaymentResult,
  PrefillCustomer,
  Plan,
} from './types'

type PaymentFormRootProps = PaymentFormProps & {
  /**
   * Customer name/email forwarded to backend PaymentIntent creation so the
   * server-side customer record is authoritative. Echoed back via
   * `useCustomer()` after the intent is created.
   */
  prefillCustomer?: PrefillCustomer
  /**
   * When true, the default tree renders a terms checkbox and gates the
   * submit button until it is ticked.
   */
  requireTermsAcceptance?: boolean
  /** Slot composition. When omitted, a sensible default tree is rendered. */
  children?: React.ReactNode
}

/**
 * Inner form: lives inside Stripe `<Elements>`, wires up submission, and
 * provides `PaymentFormContext` to slot subcomponents (or to the default
 * tree when `children` is omitted).
 */
const PaymentFormInner: React.FC<{
  planRef?: string
  productRef?: string
  prefillCustomer?: PrefillCustomer
  resolvedPlanRef: string | null
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
  const { refetch } = usePurchase()

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
      const msg = !stripe || !elements
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

    if (result.status === 'requires_action') {
      setError(result.message)
      setIsProcessing(false)
      return
    }

    if (result.status === 'other') {
      setError(result.message)
      setIsProcessing(false)
      return
    }

    // succeeded — forward to backend processor
    const paymentIntent = result.paymentIntent
    const reconcileResult = await reconcilePayment({
      paymentIntentId: paymentIntent.id as string,
      productRef,
      planRef: planRef || resolvedPlanRef || undefined,
      processPayment,
      refetchPurchase: refetch,
      copy,
    })

    setIsProcessing(false)

    if (reconcileResult.status === 'success') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pi = paymentIntent as any
      onSuccess?.(pi)
      const result: PaymentResult = { kind: 'paid', paymentIntent: pi }
      onResult?.(result)
      return
    }

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
      plan: null,
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

  const defaultTree = (
    <>
      <PaymentFormSummary />
      <PaymentFormCustomerFields />
      <PaymentFormPaymentElement />
      <PaymentFormError />
      <PaymentFormMandateText />
      {requireTermsAcceptance && <PaymentFormTermsCheckbox />}
      <PaymentFormSubmitButton />
    </>
  )

  return (
    <PaymentFormProvider value={contextValue}>
      {children ?? defaultTree}
    </PaymentFormProvider>
  )
}

/**
 * Free-plan branch rendered when `plan.requiresPayment === false`. Bypasses
 * Stripe Elements entirely: no client secret, no payment confirmation. On
 * submit, calls the `onFreePlan` override if provided, otherwise activates
 * via `useActivation`. Fires `onResult({ kind: 'activated', ... })` on success.
 */
const FreePlanActivationForm: React.FC<{
  className?: string
  plan: Plan
  productRef?: string
  requireTermsAcceptance: boolean
  submitButtonText?: string
  buttonClassName?: string
  onFreePlan?: PaymentFormProps['onFreePlan']
  onResult?: PaymentFormProps['onResult']
  onError?: PaymentFormProps['onError']
}> = ({
  className,
  plan,
  productRef,
  requireTermsAcceptance,
  submitButtonText,
  buttonClassName,
  onFreePlan,
  onResult,
  onError,
}) => {
  const copy = useCopy()
  const { refetch } = usePurchase()
  const { activate, state, error: activationError, result } = useActivation()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const resultFiredRef = useRef(false)

  useEffect(() => {
    if (state === 'activated' && result && !resultFiredRef.current) {
      resultFiredRef.current = true
      const activationResult: ActivationResult = { kind: 'activated', result }
      onResult?.(activationResult)
      refetch().catch(() => {
        // refetch errors are non-fatal for activation success
      })
    }
  }, [state, result, onResult, refetch])

  const isProcessing = state === 'activating'
  const canSubmit =
    !isProcessing && (!requireTermsAcceptance || termsAccepted) && !!productRef

  const handleSubmit = useCallback(async () => {
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
        // When the integrator handles activation themselves, we still emit
        // a synthetic activated result so `onResult` consumers get notified.
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

  const productName =
    typeof plan.metadata?.productName === 'string'
      ? plan.metadata.productName
      : plan.name ?? 'product'
  const label = interpolate(copy.cta.startUsing, { product: productName })
  const errorText = localError ?? activationError

  return (
    <div className={className}>
      <CheckoutSummary planRef={plan.reference} productRef={productRef} />
      <div style={{ marginTop: 16 }}>
        <MandateText planRef={plan.reference} productRef={productRef} />
      </div>
      {requireTermsAcceptance && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={e => setTermsAccepted(e.target.checked)}
          />
          <span>{copy.terms.checkboxLabel}</span>
        </label>
      )}
      {errorText && (
        <div
          role="alert"
          style={{ marginTop: 12, color: '#b91c1c', fontSize: 14 }}
        >
          {errorText}
        </div>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={buttonClassName}
        style={{ marginTop: 16 }}
        aria-busy={isProcessing}
      >
        {isProcessing ? copy.cta.processing : submitButtonText ?? label}
      </button>
    </div>
  )
}

const PaymentFormBase: React.FC<PaymentFormRootProps> = ({
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
}) => {
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
    // Free plans skip createPayment entirely — no clientSecret, no Elements.
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
      <div className={className}>
        <div>{copy.errors.configMissingPlanOrProduct}</div>
      </div>
    )
  }

  if (checkoutError) {
    return (
      <div className={className}>
        <div>{copy.errors.paymentInitFailed}</div>
        <div>{checkoutError.message || copy.errors.unknownError}</div>
      </div>
    )
  }

  if (isFreePlan && resolvedPlan) {
    return (
      <FreePlanActivationForm
        className={className}
        plan={resolvedPlan}
        productRef={effectiveProductRef}
        requireTermsAcceptance={requireTermsAcceptance}
        submitButtonText={submitButtonText}
        buttonClassName={buttonClassName}
        onFreePlan={onFreePlan}
        onResult={onResult}
        onError={onError}
      />
    )
  }

  if (shouldRenderElements && elementsOptions) {
    return (
      <div className={className}>
        <Elements
          key={clientSecret!}
          stripe={stripePromise}
          options={elementsOptions}
        >
          <PaymentFormInner
            planRef={effectivePlanRef}
            productRef={effectiveProductRef}
            prefillCustomer={prefillCustomer}
            resolvedPlanRef={resolvedPlanRef}
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
          </PaymentFormInner>
        </Elements>
      </div>
    )
  }

  return (
    <div className={className}>
      <div
        style={{
          minHeight: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spinner size="md" />
      </div>
      <button
        type="submit"
        disabled
        className={buttonClassName}
        aria-busy="false"
        aria-disabled="true"
      >
        {submitButtonText ?? copy.cta.payNow}
      </button>
    </div>
  )
}

/**
 * PaymentForm root with composable slot subcomponents. The single-prop API is
 * preserved: passing no `children` renders the default tree (Summary →
 * PaymentElement → MandateText → optional TermsCheckbox → SubmitButton).
 */
export const PaymentForm: React.FC<PaymentFormRootProps> & {
  Summary: typeof PaymentFormSummary
  CustomerFields: typeof PaymentFormCustomerFields
  PaymentElement: typeof PaymentFormPaymentElement
  CardElement: typeof PaymentFormCardElement
  MandateText: typeof PaymentFormMandateText
  TermsCheckbox: typeof PaymentFormTermsCheckbox
  SubmitButton: typeof PaymentFormSubmitButton
  Error: typeof PaymentFormError
} = Object.assign(PaymentFormBase, {
  Summary: PaymentFormSummary,
  CustomerFields: PaymentFormCustomerFields,
  PaymentElement: PaymentFormPaymentElement,
  CardElement: PaymentFormCardElement,
  MandateText: PaymentFormMandateText,
  TermsCheckbox: PaymentFormTermsCheckbox,
  SubmitButton: PaymentFormSubmitButton,
  Error: PaymentFormError,
})
