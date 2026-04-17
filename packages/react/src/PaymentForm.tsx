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
import { Spinner } from './components/Spinner'
import {
  PaymentFormProvider,
  type PaymentElementKind,
  type PaymentFormContextValue,
} from './components/PaymentFormContext'
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
import type { PaymentFormProps, PrefillCustomer } from './types'

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
      onSuccess?.(paymentIntent as any)
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

const PaymentFormBase: React.FC<PaymentFormRootProps> = ({
  planRef,
  productRef,
  onSuccess,
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
  const {
    loading: checkoutLoading,
    error: checkoutError,
    clientSecret,
    startCheckout,
    stripePromise,
    resolvedPlanRef,
  } = useCheckout({ planRef, productRef, customer: prefillCustomer })

  const hasInitializedRef = useRef(false)
  const hasPlanOrProduct = !!(planRef || productRef)

  useEffect(() => {
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
  }, [hasPlanOrProduct, checkoutLoading, checkoutError, clientSecret, startCheckout])

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

  if (shouldRenderElements && elementsOptions) {
    return (
      <div className={className}>
        <Elements
          key={clientSecret!}
          stripe={stripePromise}
          options={elementsOptions}
        >
          <PaymentFormInner
            planRef={planRef}
            productRef={productRef}
            prefillCustomer={prefillCustomer}
            resolvedPlanRef={resolvedPlanRef}
            clientSecret={clientSecret!}
            returnUrl={finalReturnUrl}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
            requireTermsAcceptance={requireTermsAcceptance}
            onSuccess={onSuccess}
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
