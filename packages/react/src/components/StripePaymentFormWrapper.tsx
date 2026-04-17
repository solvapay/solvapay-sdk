'use client'
import React, { useState } from 'react'
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js'
import { useCustomer } from '../hooks/useCustomer'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { Spinner } from './Spinner'

interface StripePaymentFormWrapperProps {
  onSuccess?: (paymentIntent: unknown) => void | Promise<void>
  onError?: (error: Error) => void
  returnUrl?: string
  submitButtonText?: string
  buttonClassName?: string
  clientSecret: string
}

/**
 * Stripe Payment Form Wrapper Component
 * Renders inside Stripe Elements context and handles the payment flow
 * All hooks are called unconditionally to comply with React Rules of Hooks
 */
export const StripePaymentFormWrapper: React.FC<StripePaymentFormWrapperProps> = ({
  onSuccess,
  onError,
  returnUrl: _returnUrl,
  submitButtonText,
  buttonClassName,
  clientSecret,
}) => {
  // Always call hooks unconditionally
  const stripe = useStripe()
  const elements = useElements()
  const customer = useCustomer()
  const copy = useCopy()
  const effectiveSubmitText = submitButtonText ?? copy.cta.payNow
  const [isProcessing, setIsProcessing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cardComplete, setCardComplete] = useState(false)

  const handleSubmit = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    // Double-check Stripe availability (defensive programming)
    if (!stripe || !elements) {
      const errorMessage = copy.errors.stripeUnavailable
      setMessage(errorMessage)
      if (onError) {
        onError(new Error(errorMessage))
      }
      return
    }

    if (!clientSecret) {
      const errorMessage = copy.errors.paymentIntentUnavailable
      setMessage(errorMessage)
      if (onError) {
        onError(new Error(errorMessage))
      }
      return
    }

    setIsProcessing(true)
    setMessage(null)

    try {
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) {
        const errorMessage = copy.errors.cardElementMissing
        setMessage(errorMessage)
        setIsProcessing(false)
        if (onError) {
          onError(new Error(errorMessage))
        }
        return
      }

      // Confirm the payment using the clientSecret from the payment intent
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            email: customer.email,
            name: customer.name,
          },
        },
      })

      if (error) {
        // Show error to customer (e.g., payment details are invalid)
        const errorMessage = error.message || copy.errors.paymentUnexpected
        setMessage(errorMessage)
        setIsProcessing(false)

        if (onError) {
          onError(new Error(errorMessage))
        }
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded on Stripe side - now wait for backend processing
        // Don't show any message during processing - wait for backend to confirm
        setMessage(null)

        if (onSuccess) {
          try {
            // Wait for backend processing to complete
            await onSuccess(paymentIntent)
            // Backend processing completed - now show success
            setMessage('Payment successful!')
          } catch (err) {
            // Backend processing failed
            const error = err instanceof Error ? err : new Error(copy.errors.paymentProcessingFailed)
            setMessage(copy.errors.paymentProcessingFailed)
            setIsProcessing(false)

            if (onError) {
              onError(error)
            }
            return
          }
        } else {
          // No onSuccess callback - show success immediately
          setMessage('Payment successful!')
        }
      } else if (paymentIntent && paymentIntent.status === 'requires_action') {
        // Payment requires additional action (3D Secure, etc.)
        setMessage(copy.errors.paymentRequires3ds)
        setIsProcessing(false)
      } else if (paymentIntent) {
        setMessage(
          interpolate(copy.errors.paymentStatusPrefix, {
            status: paymentIntent.status || 'processing',
          }),
        )
        setIsProcessing(false)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(copy.errors.unknownError)
      setMessage(error.message)

      if (onError) {
        onError(error)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const isSuccess = message?.includes('successful') ?? false

  const isReady = !!(stripe && elements)

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '17px',
        lineHeight: '24px',
        color: '#1e293b',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        '::placeholder': {
          color: '#94a3b8',
        },
      },
      invalid: {
        color: '#dc2626',
      },
    },
    hidePostalCode: true,
  }

  return (
    <>
      {isReady ? (
        <CardElement
          options={cardElementOptions}
          onChange={e => {
            if (e.error) {
              setMessage(e.error.message)
              setCardComplete(false)
            } else {
              setMessage(null)
              setCardComplete(e.complete)
            }
          }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '52px' }}>
          <Spinner size="sm" />
        </div>
      )}

      {message && !isSuccess && (
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={!isReady || !cardComplete || isProcessing || !clientSecret}
        className={buttonClassName}
        aria-busy={isProcessing}
        aria-disabled={!isReady || !cardComplete || isProcessing || !clientSecret}
        onClick={handleSubmit}
      >
        {isProcessing ? (
          <>
            <Spinner size="sm" />
            <span>{copy.cta.processing}</span>
          </>
        ) : (
          effectiveSubmitText
        )}
      </button>
    </>
  )
}
