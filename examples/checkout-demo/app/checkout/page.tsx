'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  useCustomer,
  usePurchase,
  CheckoutLayout,
  CancelledPlanNotice,
  CancelPlanButton,
  type CheckoutResult,
} from '@solvapay/react'
import { SuccessMessage } from './components/SuccessMessage'
import { PaymentFailureMessage } from './components/PaymentFailureMessage'

/**
 * Drop-in checkout page. The SDK's `<CheckoutLayout>` handles plan
 * selection + payment + activation internally; the surrounding page only
 * owns the cancel / cancelled-plan / success / redirect shell.
 */
export default function CheckoutPage() {
  const { email, name } = useCustomer()
  const { activePurchase } = usePurchase()
  const router = useRouter()
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const productRef = process.env.NEXT_PUBLIC_PRODUCT_REF

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current)
    }
  }, [])

  const handleResult = (_result: CheckoutResult) => {
    setPaymentSuccess(true)
    redirectTimeoutRef.current = setTimeout(() => router.push('/'), 2000)
  }

  const handleError = () => setPaymentFailed(true)

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-slate-600 hover:text-slate-900 mb-8 inline-block">
          ← Back
        </Link>

        {paymentFailed ? (
          <PaymentFailureMessage />
        ) : paymentSuccess ? (
          <SuccessMessage />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
            <CancelledPlanNotice />

            {productRef ? (
              <CheckoutLayout
                productRef={productRef}
                prefillCustomer={{ email: email ?? undefined, name: name ?? undefined }}
                initialPlanRef={activePurchase?.planRef}
                requireTermsAcceptance
                onResult={handleResult}
                onError={handleError}
              />
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
                Missing NEXT_PUBLIC_PRODUCT_REF environment variable.
              </div>
            )}

            {activePurchase && (
              <div className="pt-4 border-t border-slate-200">
                <CancelPlanButton onCancelled={() => router.push('/')} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
