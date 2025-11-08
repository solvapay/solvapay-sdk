'use client'
import React, { useState } from 'react'
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js'
import { useCustomer } from '../hooks/useCustomer'
import { Spinner } from './Spinner'

interface StripePaymentFormWrapperProps {
  onSuccess?: (paymentIntent: any) => void | Promise<void>
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
  submitButtonText = 'Pay Now',
  buttonClassName,
  clientSecret,
}) => {
  // Always call hooks unconditionally
  const stripe = useStripe()
  const elements = useElements()
  const customer = useCustomer()
  const [isProcessing, setIsProcessing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cardComplete, setCardComplete] = useState(false)

  const handleSubmit = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    // Double-check Stripe availability (defensive programming)
    if (!stripe || !elements) {
      const errorMessage = 'Stripe is not available. Please refresh the page.'
      setMessage(errorMessage)
      if (onError) {
        onError(new Error(errorMessage))
      }
      return
    }

    if (!clientSecret) {
      const errorMessage = 'Payment intent not available. Please refresh the page.'
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
        const errorMessage = 'Card element not found'
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
        const errorMessage = error.message || 'An unexpected error occurred.'
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
            const error = err instanceof Error ? err : new Error('Payment processing failed')
            setMessage('Payment processing failed. Please try again or contact support.')
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
        setMessage('Payment requires additional authentication. Please complete the verification.')
        setIsProcessing(false)
      } else if (paymentIntent) {
        // Payment is processing or requires additional action
        setMessage(`Payment status: ${paymentIntent.status || 'processing'}`)
        setIsProcessing(false)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error occurred')
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

  // Card element options for minimal styling
  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#424770',
        '::placeholder': {
          color: '#aab7c4',
        },
      },
      invalid: {
        color: '#9e2146',
      },
    },
    hidePostalCode: true,
  }

  return (
    <>
      {/* CardElement - render when ready, show loading placeholder while initializing */}
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
        <div
          style={{
            padding: '12px',
            border: '1px solid #cbd5e1',
            borderRadius: '0.375rem',
            backgroundColor: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '40px',
          }}
        >
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
            <span>Processing...</span>
          </>
        ) : (
          submitButtonText
        )}
      </button>
    </>
  )
}
