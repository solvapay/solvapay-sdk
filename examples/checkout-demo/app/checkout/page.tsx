'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePurchase, CancelledPlanNotice, CancelPlanButton } from '@solvapay/react'
import type { SuccessMeta } from '@solvapay/react/primitives'
import { CheckoutFlowPanel } from './components/CheckoutFlowPanel'
import { PaymentFailureMessage } from './components/PaymentFailureMessage'

/**
 * Checkout page using `CheckoutSteps` / `useCheckoutFlow` — same engine as
 * Goldberg MCP and chat-checkout-demo. Shows Subscription and Pay-as-you-go
 * side by side (the SDK default filter hides PAYG when recurring exists).
 */
export default function CheckoutPage() {
  const { activePurchase } = usePurchase()
  const router = useRouter()
  const [paymentFailed, setPaymentFailed] = useState(false)
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const productRef = process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) clearTimeout(redirectTimeoutRef.current)
    }
  }, [])

  const returnUrl =
    typeof window !== 'undefined' ? window.location.href : 'http://localhost:3010/checkout'

  const handlePurchaseSuccess = (_meta: SuccessMeta) => {
    redirectTimeoutRef.current = setTimeout(() => router.push('/'), 2500)
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
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
            <CancelledPlanNotice />

            {productRef ? (
              <CheckoutFlowPanel
                productRef={productRef}
                returnUrl={returnUrl}
                currentPlanRef={activePurchase?.planRef}
                onPurchaseSuccess={handlePurchaseSuccess}
                onError={handleError}
              />
            ) : (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
                Missing NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF environment variable.
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
