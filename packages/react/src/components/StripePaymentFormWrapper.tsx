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
 * @deprecated Use `PaymentForm.PaymentElement` with the Payment Element instead.
 * This Card Element wrapper is kept for compatibility and will be removed in
 * the next major release.
 */
export const StripePaymentFormWrapper: React.FC<StripePaymentFormWrapperProps> = ({
  onSuccess,
  onError,
  returnUrl: _returnUrl,
  submitButtonText,
  buttonClassName,
  clientSecret,
}) => {
  const stripe = useStripe()
  const elements = useElements()
  const customer = useCustomer()
  const copy = useCopy()
  const effectiveSubmitText = submitButtonText ?? copy.cta.payNow
  const [isProcessing, setIsProcessing] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [cardComplete, setCardComplete] = useState(false)

  const handleSubmit = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    if (!stripe || !elements) {
      const errorMessage = copy.errors.stripeUnavailable
      setMessage(errorMessage)
      onError?.(new Error(errorMessage))
      return
    }

    if (!clientSecret) {
      const errorMessage = copy.errors.paymentIntentUnavailable
      setMessage(errorMessage)
      onError?.(new Error(errorMessage))
      return
    }

    setIsProcessing(true)
    setMessage(undefined)

    try {
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) {
        const errorMessage = copy.errors.cardElementMissing
        setMessage(errorMessage)
        setIsProcessing(false)
        onError?.(new Error(errorMessage))
        return
      }

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
        const errorMessage = error.message || copy.errors.paymentUnexpected
        setMessage(errorMessage)
        setIsProcessing(false)
        onError?.(new Error(errorMessage))
        return
      }

      if (paymentIntent?.status === 'succeeded') {
        setMessage(undefined)

        if (onSuccess) {
          try {
            await onSuccess(paymentIntent)
            setMessage('Payment successful!')
          } catch (err) {
            const caught = err instanceof Error ? err : new Error(copy.errors.paymentProcessingFailed)
            setMessage(copy.errors.paymentProcessingFailed)
            setIsProcessing(false)
            onError?.(caught)
            return
          }
        } else {
          setMessage('Payment successful!')
        }
        return
      }

      if (paymentIntent?.status === 'requires_action') {
        setMessage(copy.errors.paymentRequires3ds)
        setIsProcessing(false)
        return
      }

      if (paymentIntent) {
        setMessage(
          interpolate(copy.errors.paymentStatusPrefix, {
            status: paymentIntent.status || 'processing',
          }),
        )
        setIsProcessing(false)
      }
    } catch (err) {
      const caught = err instanceof Error ? err : new Error(copy.errors.unknownError)
      setMessage(caught.message)
      onError?.(caught)
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
              setMessage(undefined)
              setCardComplete(e.complete)
            }
          }}
        />
      ) : (
        <output
          data-solvapay-payment-form-loading=""
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '52px' }}
        >
          <Spinner size="sm" />
        </output>
      )}

      {message && !isSuccess && (
        <output role="alert" aria-live="assertive" aria-atomic="true">
          {message}
        </output>
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

export type { StripePaymentFormWrapperProps }
