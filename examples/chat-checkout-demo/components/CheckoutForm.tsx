import React, { useCallback, useEffect, useState } from 'react'
import { PaymentForm } from '@solvapay/react/primitives'
import { usePlans, useTransport } from '@solvapay/react'
import { CheckCircleIcon } from './icons/CheckCircleIcon'
import { LockIcon } from './icons/LockIcon'
import { PlanPicker } from './PlanPicker'
import { env } from '../src/lib/env'

interface CheckoutFormProps {
  onSuccess: () => void
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({ onSuccess }) => {
  const [isSuccess, setIsSuccess] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [selectedRef, setSelectedRef] = useState<string | null>(null)

  const transport = useTransport()
  const fetcher = useCallback(
    async (ref: string) => {
      if (!transport.listPlans) throw new Error('Transport does not support listPlans')
      return transport.listPlans(ref)
    },
    [transport],
  )
  const productRef = env.subscription.productRef
  const { plans, loading, error } = usePlans({ productRef: productRef || undefined, fetcher })

  useEffect(() => {
    if (plans.length === 1 && !selectedRef) {
      setSelectedRef(plans[0].reference)
    }
  }, [plans, selectedRef])

  const handlePaid = () => {
    setIsSuccess(true)
    window.setTimeout(onSuccess, 1500)
  }

  const handleError = (e: Error) => {
    console.error('[CheckoutForm] payment error:', e)
    setPaymentError(e.message)
  }

  if (isSuccess) {
    return (
      <div className="px-4 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 border border-emerald-200">
              <CheckCircleIcon className="h-6 w-6 text-emerald-700" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mt-3">Payment successful</h2>
            <p className="text-slate-500 mt-1">Welcome to Premium. You now have unlimited access.</p>
          </div>
        </div>
      </div>
    )
  }

  if (!productRef) {
    return (
      <div className="px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            Set <code className="font-mono">VITE_SUBSCRIPTION_PRODUCT_REF</code> in{' '}
            <code>.env</code> to enable the subscription scenario.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Upgrade to Premium</h2>
          <p className="text-sm text-slate-600 mb-4">
            Enter your payment details to unlock unlimited messages.
          </p>

          {loading ? (
            <PlansLoading />
          ) : error || plans.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              No plans found for this product. Add at least one plan in the SolvaPay dashboard, or
              double-check <code className="font-mono">VITE_SUBSCRIPTION_PRODUCT_REF</code>.
            </div>
          ) : plans.length > 1 && !selectedRef ? (
            <PlanPicker plans={plans} selectedRef={selectedRef} onSelect={setSelectedRef} />
          ) : selectedRef ? (
            <>
              {plans.length > 1 && (
                <div className="mb-5">
                  <PlanPicker
                    plans={plans}
                    selectedRef={selectedRef}
                    onSelect={setSelectedRef}
                  />
                </div>
              )}
              <PaymentForm.Root
                productRef={productRef}
                planRef={selectedRef}
                onSuccess={handlePaid}
                onError={handleError}
              >
                <div className="space-y-4">
                  <PaymentForm.PaymentElement />
                  <div className="flex items-center justify-end text-xs text-slate-500">
                    <LockIcon className="h-3.5 w-3.5 mr-1" />
                    Secured by Stripe
                  </div>
                </div>

                <PaymentForm.Error className="mt-3 text-sm text-red-600" />

                <div className="mt-5">
                  <PaymentForm.SubmitButton asChild>
                    <button className="group w-full flex justify-center items-center py-2.5 px-4 rounded-full text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed" />
                  </PaymentForm.SubmitButton>
                </div>
              </PaymentForm.Root>

              {paymentError && <p className="mt-3 text-xs text-red-600">{paymentError}</p>}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const PlansLoading: React.FC = () => (
  <div className="flex items-center justify-center py-8">
    <svg
      className="animate-spin h-5 w-5 text-slate-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  </div>
)
