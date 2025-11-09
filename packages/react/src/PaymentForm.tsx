'use client'
import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { useCheckout } from './hooks/useCheckout'
import { useSubscription } from './hooks/useSubscription'
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
 * Features:
 * - Automatic Stripe Elements initialization
 * - Payment intent creation on mount
 * - Card input and validation
 * - Payment processing with error handling
 * - Automatic subscription refresh after payment
 *
 * @param props - Payment form configuration
 * @param props.planRef - Plan reference to subscribe to (required)
 * @param props.agentRef - Agent reference for usage tracking (required)
 * @param props.onSuccess - Callback when payment succeeds
 * @param props.onError - Callback when payment fails
 * @param props.returnUrl - Optional return URL after payment (for redirects)
 * @param props.submitButtonText - Custom text for submit button (default: 'Pay Now')
 * @param props.className - Custom CSS class for the form container
 * @param props.buttonClassName - Custom CSS class for the submit button
 *
 * @example
 * ```tsx
 * import { PaymentForm } from '@solvapay/react';
 * import { useRouter } from 'next/navigation';
 *
 * function CheckoutPage() {
 *   const router = useRouter();
 *
 *   return (
 *     <PaymentForm
 *       planRef="pln_premium"
 *       agentRef="agt_myapi"
 *       onSuccess={() => {
 *         console.log('Payment successful!');
 *         router.push('/dashboard');
 *       }}
 *       onError={(error) => {
 *         console.error('Payment failed:', error);
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * @see {@link useCheckout} for programmatic checkout handling
 * @see {@link SolvaPayProvider} for required context provider
 * @since 1.0.0
 */
export const PaymentForm: React.FC<PaymentFormProps> = ({
  planRef,
  agentRef,
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Pay Now',
  className,
  buttonClassName,
}) => {
  // CRITICAL: Always call hooks unconditionally FIRST, before any early returns
  // Use a safe fallback for planRef to ensure hooks always receive valid input
  const validPlanRef = planRef && typeof planRef === 'string' ? planRef : ''
  const checkout = useCheckout(validPlanRef, agentRef)
  const { refetch } = useSubscription()
  const { processPayment } = useSolvaPay()
  const hasInitializedRef = useRef(false)

  // Auto-start checkout on mount - only once
  useEffect(() => {
    if (
      !hasInitializedRef.current &&
      validPlanRef &&
      !checkout.loading &&
      !checkout.error &&
      !checkout.clientSecret
    ) {
      hasInitializedRef.current = true
      checkout.startCheckout().catch(() => {
        // Error handled by useCheckout hook
        hasInitializedRef.current = false // Allow retry on error
      })
    }
    // Reset initialization flag if planRef changes
    if (validPlanRef && checkout.clientSecret) {
      hasInitializedRef.current = true
    }
  }, [
    validPlanRef,
    checkout.loading,
    checkout.error,
    checkout.clientSecret,
    checkout.startCheckout,
  ])

  // Handle successful payment
  const handleSuccess = useCallback(
    async (paymentIntent: any) => {
      let processingTimeout = false
      let processingResult: any = null

      // Process payment if we have the necessary data (customerRef is handled internally)
      if (processPayment && agentRef) {
        try {
          const result = await processPayment({
            paymentIntentId: paymentIntent.id,
            agentRef: agentRef,
            planRef: planRef,
          })
          processingResult = result

          // Check if the result indicates a timeout
          // The API can return status: 'timeout' even though TypeScript types say 'completed'
          const isTimeout = (result as any)?.status === 'timeout'
          processingTimeout = isTimeout

          if (isTimeout) {
            // Poll for subscription up to 5 times with increasing delays
            for (let attempt = 1; attempt <= 5; attempt++) {
              const delay = attempt * 1000 // 1s, 2s, 3s, 4s, 5s
              await new Promise(resolve => setTimeout(resolve, delay))
              await refetch()
            }

            // Call onSuccess with timeout info first (so CheckoutPage can show failure page)
            if (onSuccess) {
              await onSuccess({
                ...paymentIntent,
                _processingTimeout: processingTimeout,
                _processingResult: processingResult,
              })
            }

            // Then throw error to signal timeout to StripePaymentFormWrapper
            // This will show error state in the form instead of success
            throw new Error('Payment processing timed out')
          } else {
            await refetch()
          }
        } catch (error) {
          console.error('[PaymentForm] Failed to process payment:', error)

          // Call onSuccess with error info so CheckoutPage can show failure page
          if (onSuccess) {
            try {
              await onSuccess({
                ...paymentIntent,
                _processingError: error,
              })
            } catch {
              // Ignore callback errors
            }
          }

          // Re-throw the error so StripePaymentFormWrapper can show error state
          throw error
        }
      } else {
        // No processPayment available, refetch anyway (webhook might have processed)
        await refetch()
      }

      // Call onSuccess callback (only if we haven't already called it for timeout case)
      if (onSuccess && !processingTimeout) {
        await onSuccess({
          ...paymentIntent,
          _processingTimeout: processingTimeout,
          _processingResult: processingResult,
        })
      }
    },
    [processPayment, agentRef, planRef, refetch, onSuccess],
  )

  // Handle payment error
  const handleError = useCallback(
    (err: Error) => {
      if (onError) {
        onError(err)
      }
    },
    [onError],
  )

  // Auto-detect return URL if not provided
  const finalReturnUrl = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/')

  // Validate planRef AFTER all hooks are called
  const isValidPlanRef = planRef && typeof planRef === 'string'

  // Determine render state
  const hasError = !!checkout.error
  const hasStripeData = !!(checkout.stripePromise && checkout.clientSecret)

  // Memoize Elements options to maintain stable identity while clientSecret stays the same
  const elementsOptions = useMemo(() => {
    if (!checkout.clientSecret) return undefined
    return { clientSecret: checkout.clientSecret }
  }, [checkout.clientSecret])

  // Track if Elements has ever been mounted for this planRef to prevent unmounting
  // Reset when planRef changes (component will remount due to key prop)
  const [hasMountedElements, setHasMountedElements] = useState(false)

  // Update state when Stripe data becomes available
  useEffect(() => {
    if (hasStripeData) {
      setHasMountedElements(true)
    }
  }, [hasStripeData])

  // Only mount Elements once we have both stripePromise and clientSecret
  // Once mounted, keep it mounted to maintain hook consistency
  const shouldRenderElements =
    hasStripeData || (hasMountedElements && checkout.stripePromise && checkout.clientSecret)

  // Always return the same JSX structure to maintain hook consistency
  // Once Elements is rendered, it should never unmount to avoid hook count issues
  return (
    <div className={className}>
      {!isValidPlanRef ? (
        <div>PaymentForm: planRef is required and must be a string</div>
      ) : hasError ? (
        <div>
          <div>Payment initialization failed</div>
          <div>{checkout.error?.message || 'Unknown error'}</div>
        </div>
      ) : shouldRenderElements && checkout.stripePromise && elementsOptions ? (
        // Once we have Stripe data, always render Elements to maintain hook consistency
        // This prevents hook count mismatches when transitioning between states
        <Elements
          key={checkout.clientSecret!}
          stripe={checkout.stripePromise}
          options={elementsOptions}
        >
          <StripePaymentFormWrapper
            onSuccess={handleSuccess}
            onError={handleError}
            returnUrl={finalReturnUrl}
            submitButtonText={submitButtonText}
            buttonClassName={buttonClassName}
            clientSecret={checkout.clientSecret!}
          />
        </Elements>
      ) : (
        // Loading state before Stripe data is available
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
