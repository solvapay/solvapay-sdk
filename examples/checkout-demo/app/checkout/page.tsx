'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePurchase, usePlans, usePurchaseStatus } from '@solvapay/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAccessToken } from '../lib/supabase'
import { sortPlansByPrice } from './utils/planHelpers'
import { PlanSelectionSection } from './components/PlanSelectionSection'
import { PaymentSummary } from './components/PaymentSummary'
import { PurchaseNotices } from './components/PurchaseNotices'
import { CheckoutActions } from './components/CheckoutActions'
import { StyledPaymentForm } from './components/StyledPaymentForm'
import { ActivationSection } from './components/ActivationSection'
import { SuccessMessage } from './components/SuccessMessage'
import { PaymentFailureMessage } from './components/PaymentFailureMessage'

interface PaymentIntentResult {
  _processingTimeout?: boolean
  _processingError?: string
  [key: string]: unknown
}

export default function CheckoutPage() {
  const [showPaymentForm, setShowPaymentForm] = useState<boolean>(false)
  const [showActivation, setShowActivation] = useState<boolean>(false)
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false)
  const [paymentFailed, setPaymentFailed] = useState<boolean>(false)
  const [isCancelling, setIsCancelling] = useState<boolean>(false)
  const [isReactivating, setIsReactivating] = useState<boolean>(false)
  const { refetch, hasPaidPurchase, activePaidPurchase, activePurchase } =
    usePurchase()
  const router = useRouter()
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const productRef = process.env.NEXT_PUBLIC_PRODUCT_REF

  // Stable fetcher function to prevent re-renders
  const plansFetcher = useCallback(async (productRef: string) => {
    const response = await fetch(`/api/list-plans?productRef=${productRef}`)
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to fetch plans')
    }
    const data = await response.json()
    // Sort and limit to first 2 plans in fetcher
    const sortedPlans = (data.plans || []).sort(sortPlansByPrice).slice(0, 2)
    return sortedPlans
  }, [])

  // Fetch plans using the SDK hook
  const {
    plans,
    loading,
    error,
    selectedPlanIndex,
    selectedPlan: currentPlan,
    setSelectedPlanIndex,
  } = usePlans({
    productRef: productRef || '',
    fetcher: plansFetcher,
    autoSelectFirstPaid: true,
  })

  // Get advanced purchase status helpers
  const purchaseStatus = usePurchaseStatus()

  // Note: Provider auto-fetches purchases on mount, so no manual refetch needed here
  // Refetch is only called after operations that change purchase state (payment, cancellation)

  // Handle payment success
  const handlePaymentSuccess = async (paymentIntent?: unknown) => {
    const result = paymentIntent as PaymentIntentResult | undefined
    // Check if payment processing timed out or had an error
    const isTimeout = result?._processingTimeout === true
    const hasError = !!result?._processingError

    // Refetch purchases before showing message
    await refetch()

    if (isTimeout || hasError) {
      if (isTimeout) {
        console.error(
          '[CheckoutPage] Payment processing timed out - webhooks may not be configured',
        )
      } else if (hasError) {
        console.error('[CheckoutPage] Payment processing failed:', result?._processingError)
      }

      // Show failure message to user (no technical details)
      setPaymentFailed(true)
    } else {
      // Only set success if there was no timeout or error
      setPaymentSuccess(true)
      redirectTimeoutRef.current = setTimeout(() => {
        router.push('/')
      }, 2000)
    }
  }

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current)
      }
    }
  }, [])

  // Handle payment error
  const handlePaymentError = (err: Error) => {
    console.error('[CheckoutPage] Payment error:', err.message)

    // Show failure message to user (no technical details)
    setShowPaymentForm(false)
    setPaymentFailed(true)
  }

  // Handle continue button click
  const handleActivationSuccess = async () => {
    await refetch()
    setPaymentSuccess(true)
    redirectTimeoutRef.current = setTimeout(() => {
      router.push('/')
    }, 2000)
  }

  const handleContinue = () => {
    if (currentPlan?.type === 'usage-based') {
      setShowActivation(true)
    } else if (currentPlan?.requiresPayment !== false) {
      setShowPaymentForm(true)
    }
  }

  // Handle cancel plan
  const handleCancelPlan = async () => {
    const purchase = activePaidPurchase || activePurchase
    if (!purchase) return

    const isUsageBased = activePurchase?.planSnapshot?.planType === 'usage-based'
    const confirmMsg = isUsageBased
      ? 'Are you sure you want to deactivate your plan? This will take effect immediately.'
      : 'Are you sure you want to cancel your plan?'

    if (!confirm(confirmMsg)) return

    if (purchase.status !== 'active') {
      await refetch()
      return
    }

    setIsCancelling(true)

    try {
      const accessToken = await getAccessToken()

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      }

      const res = await fetch('/api/cancel-renewal', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          purchaseRef: purchase.reference,
          reason: 'User requested cancellation',
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        const errorMessage = errorData.error || 'Failed to cancel'
        console.error('Cancel error:', errorMessage, errorData)
        throw new Error(errorMessage)
      }

      await res.json()
      await new Promise(resolve => setTimeout(resolve, 300))
      await refetch()
      window.location.href = '/'
    } catch (err) {
      console.error('Cancel failed:', err)
      setIsCancelling(false)
    }
  }

  const handleReactivate = async () => {
    const purchase = purchaseStatus.cancelledPurchase
    if (!purchase) return

    setIsReactivating(true)

    try {
      const accessToken = await getAccessToken()

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      }

      const res = await fetch('/api/reactivate-renewal', {
        method: 'POST',
        headers,
        body: JSON.stringify({ purchaseRef: purchase.reference }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        const errorMessage = errorData.error || 'Failed to reactivate'
        console.error('Reactivate error:', errorMessage, errorData)
        throw new Error(errorMessage)
      }

      await res.json()
      await new Promise(resolve => setTimeout(resolve, 300))
      await refetch()
    } catch (err) {
      console.error('Reactivate failed:', err)
    } finally {
      setIsReactivating(false)
    }
  }

  // Handle back to plan selection
  const handleBackToSelection = () => {
    setShowPaymentForm(false)
    setShowActivation(false)
  }

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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h2 className="text-xl font-semibold text-slate-900 mb-8">Choose your pricing</h2>

            {loading && <div className="text-center py-8 text-slate-500">Loading pricing...</div>}

            {error && !loading && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
                {error.message}
              </div>
            )}

            {!loading && !error && plans.length > 0 && currentPlan && currentPlan.reference && (
              <>
                {!showPaymentForm && !showActivation && (
                  <>
                    <PlanSelectionSection
                      plans={plans}
                      selectedPlanIndex={selectedPlanIndex}
                      activePlanRef={activePurchase?.planSnapshot?.reference ?? null}
                      onSelectPlan={setSelectedPlanIndex}
                      className="mb-8"
                    />

                    <PaymentSummary selectedPlan={currentPlan} className="mb-8" />

                    <PurchaseNotices
                      cancelledPurchase={purchaseStatus.cancelledPurchase}
                      shouldShow={purchaseStatus.shouldShowCancelledNotice}
                      onReactivate={handleReactivate}
                      isReactivating={isReactivating}
                      className="mb-6"
                    />

                    <CheckoutActions
                      hasPaidPurchase={hasPaidPurchase}
                      activePurchase={activePurchase}
                      selectedPlanRef={currentPlan.reference}
                      shouldShowCancelledNotice={purchaseStatus.shouldShowCancelledNotice}
                      onContinue={handleContinue}
                      onCancel={handleCancelPlan}
                      isPreparingCheckout={false}
                      isCancelling={isCancelling}
                    />
                  </>
                )}

                {showActivation && (
                  <ActivationSection
                    currentPlan={currentPlan}
                    productRef={productRef}
                    onSuccess={handleActivationSuccess}
                    onBack={handleBackToSelection}
                  />
                )}

                {showPaymentForm && (
                  <StyledPaymentForm
                    currentPlan={currentPlan}
                    productRef={productRef}
                    onSuccess={handlePaymentSuccess}
                    onError={handlePaymentError}
                    onBack={handleBackToSelection}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
