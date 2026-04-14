'use client'
import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { useCheckout } from './hooks/useCheckout'
import { usePurchase } from './hooks/usePurchase'
import { useSolvaPay } from './hooks/useSolvaPay'
import { Spinner } from './components/Spinner'
import { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper'
import type { PaymentFormProps } from './types'

/**
 * Payment form component for handling Stripe checkout.
 *
 * This component provides a complete payment form with Stripe integration,
 * including card input, plan selection, and payment processing. It handles
 * the entire checkout flow including payment intent creation and confirmation.
 *
 * When `planRef` is omitted but `productRef` is provided, the component
 * auto-resolves the plan by fetching the product's plans and selecting the
 * single active plan or the one marked as default.
 *
 * @param props - Payment form configuration
 * @param props.planRef - Plan reference (optional if product has single/default plan)
 * @param props.productRef - Product reference (required when planRef is omitted)
 * @param props.onSuccess - Callback when payment succeeds
 * @param props.onError - Callback when payment fails
 * @param props.returnUrl - Optional return URL after payment (for redirects)
 * @param props.submitButtonText - Custom text for submit button (default: 'Pay Now')
 * @param props.className - Custom CSS class for the form container
 * @param props.buttonClassName - Custom CSS class for the submit button
 *
 * @example
 * ```tsx
 * // Explicit plan
 * <PaymentForm planRef="pln_premium" productRef="prd_myapi" onSuccess={...} />
 *
 * // Auto-resolve plan (product must have exactly one plan or a default)
 * <PaymentForm productRef="prd_myapi" onSuccess={...} />
 * ```
 */
export const PaymentForm: React.FC<PaymentFormProps> = ({
  planRef,
  productRef,
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Pay Now',
  className,
  buttonClassName,
}) => {
  const {
    loading: checkoutLoading,
    error: checkoutError,
    clientSecret,
    startCheckout,
    stripePromise,
    resolvedPlanRef,
  } = useCheckout({ planRef, productRef })
  const { refetch } = usePurchase()
  const { processPayment } = useSolvaPay()
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

  const effectivePlanRef = planRef || resolvedPlanRef

  const handleSuccess = useCallback(
    async (paymentIntent: unknown) => {
      const paymentIntentAny = paymentIntent as Record<string, unknown>

      if (processPayment && productRef) {
        try {
          const result = await processPayment({
            paymentIntentId: paymentIntentAny.id as string,
            productRef: productRef,
            planRef: effectivePlanRef || undefined,
          })

          const isTimeout = (result as unknown as Record<string, unknown>)?.status === 'timeout'

          if (isTimeout) {
            for (let attempt = 1; attempt <= 5; attempt++) {
              await new Promise(resolve => setTimeout(resolve, attempt * 1000))
              await refetch()
            }
            const err = new Error('Payment processing timed out — webhooks may not be configured')
            onError?.(err)
            return
          }

          await refetch()
        } catch (error) {
          console.error('[PaymentForm] Failed to process payment:', error)
          onError?.(error instanceof Error ? error : new Error(String(error)))
          return
        }
      } else {
        await refetch()
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onSuccess?.(paymentIntentAny as any)
    },
    [processPayment, productRef, effectivePlanRef, refetch, onSuccess, onError],
  )

  const handleError = useCallback(
    (err: Error) => {
      if (onError) {
        onError(err)
      }
    },
    [onError],
  )

  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  const hasError = !!checkoutError
  const hasStripeData = !!(stripePromise && clientSecret)

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return undefined
    return { clientSecret: clientSecret }
  }, [clientSecret])

  const [hasMountedElements, setHasMountedElements] = useState(false)

  useEffect(() => {
    if (hasStripeData) {
      setHasMountedElements(true)
    }
  }, [hasStripeData])

  const shouldRenderElements =
    hasStripeData || (hasMountedElements && stripePromise && clientSecret)

  return (
    <div className={className}>
      {!hasPlanOrProduct ? (
        <div>PaymentForm: either planRef or productRef is required</div>
      ) : hasError ? (
        <div>
          <div>Payment initialization failed</div>
          <div>{checkoutError?.message || 'Unknown error'}</div>
        </div>
      ) : shouldRenderElements && elementsOptions ? (
        <Elements
          key={clientSecret!}
          stripe={stripePromise}
          options={elementsOptions}
        >
          <StripePaymentFormWrapper
            onSuccess={handleSuccess}
            onError={handleError}
            returnUrl={finalReturnUrl}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
            clientSecret={clientSecret!}
          />
        </Elements>
      ) : (
        <div>
          <div
            style={{
              minHeight: '40px',
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
            {submitButtonText}
          </button>
        </div>
      )}
    </div>
  )
}
