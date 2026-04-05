'use client'
import React, { useEffect, useCallback, useRef, useMemo } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { useTopup } from './hooks/useTopup'
import { Spinner } from './components/Spinner'
import { StripePaymentFormWrapper } from './components/StripePaymentFormWrapper'
import type { TopupFormProps } from './types'

/**
 * Credit top-up form with Stripe Elements.
 *
 * Unlike `PaymentForm`, this component does **not** call `processPayment`
 * after Stripe confirmation. Credits are recorded via the backend webhook
 * handler (`CreditService.recordCredit`), so `onSuccess` is called
 * immediately after `stripe.confirmCardPayment` succeeds.
 */
export const TopupForm: React.FC<TopupFormProps> = ({
  amount,
  currency,
  onSuccess,
  onError,
  returnUrl,
  submitButtonText = 'Top Up',
  className,
  buttonClassName,
}) => {
  const {
    loading: topupLoading,
    error: topupError,
    clientSecret,
    startTopup,
    stripePromise,
  } = useTopup({ amount, currency })

  const hasInitializedRef = useRef(false)
  const hasAmount = amount > 0

  useEffect(() => {
    if (
      !hasInitializedRef.current &&
      hasAmount &&
      !topupLoading &&
      !topupError &&
      !clientSecret
    ) {
      hasInitializedRef.current = true
      startTopup().catch(() => {
        hasInitializedRef.current = false
      })
    }
    if (hasAmount && clientSecret) {
      hasInitializedRef.current = true
    }
  }, [hasAmount, topupLoading, topupError, clientSecret, startTopup])

  const handleSuccess = useCallback(
    async (paymentIntent: unknown) => {
      if (onSuccess) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await onSuccess(paymentIntent as any)
      }
    },
    [onSuccess],
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

  const hasError = !!topupError
  const hasStripeData = !!(stripePromise && clientSecret)

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return undefined
    return { clientSecret }
  }, [clientSecret])

  return (
    <div className={className}>
      {!hasAmount ? (
        <div>TopupForm: amount must be a positive number</div>
      ) : hasError ? (
        <div>
          <div>Top-up initialization failed</div>
          <div>{topupError?.message || 'Unknown error'}</div>
        </div>
      ) : hasStripeData && elementsOptions ? (
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
