'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { usePurchase, usePlans, usePurchaseStatus, usePurchaseActions, type Plan } from '@solvapay/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { sortPlansByPrice } from './utils/planHelpers'
import { PlanSelectionSection } from './components/PlanSelectionSection'
import { PaymentSummary } from './components/PaymentSummary'
import { PurchaseNotices } from './components/PurchaseNotices'
import { CheckoutActions } from './components/CheckoutActions'
import { StyledPaymentForm } from './components/StyledPaymentForm'
import { ActivationSection } from './components/ActivationSection'
import { SuccessMessage } from './components/SuccessMessage'
import { PaymentFailureMessage } from './components/PaymentFailureMessage'

export default function CheckoutPage() {
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showActivation, setShowActivation] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)
  const { refetch, activePurchase, loading: purchaseLoading } = usePurchase()
  const { cancelRenewal, reactivateRenewal, isCancelling, isReactivating } = usePurchaseActions()
  const router = useRouter()
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const productRef = process.env.NEXT_PUBLIC_PRODUCT_REF

  const plansFetcher = useCallback(async (productRef: string) => {
    const response = await fetch(`/api/list-plans?productRef=${productRef}`)
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to fetch plans')
    }
    const data = await response.json()
    return data.plans || []
  }, [])

  const showFirstTwo = useCallback((_plan: Plan, index: number) => index < 2, [])

  const {
    plans,
    loading,
    error,
    selectedPlanIndex,
    selectedPlan: currentPlan,
    setSelectedPlanIndex,
    isSelectionReady,
  } = usePlans({
    productRef: productRef || '',
    fetcher: plansFetcher,
    sortBy: sortPlansByPrice,
    filter: showFirstTwo,
    initialPlanRef: activePurchase?.planReference,
    selectionReady: !purchaseLoading,
    autoSelectFirstPaid: true,
  })

  const purchaseStatus = usePurchaseStatus()

  const activePlanIdx = useMemo(() => {
    if (!activePurchase?.planReference || plans.length === 0) return -1
    return plans.findIndex(p => p.reference === activePurchase.planReference)
  }, [activePurchase, plans])

  const isOnActivePlan = useMemo(() => {
    if (!activePurchase || !currentPlan) return false
    return activePurchase.planReference === currentPlan.reference
  }, [activePurchase, currentPlan])

  const handlePaymentSuccess = async () => {
    await refetch()
    setPaymentSuccess(true)
    redirectTimeoutRef.current = setTimeout(() => {
      router.push('/')
    }, 2000)
  }

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current)
      }
    }
  }, [])

  const handlePaymentError = (_err: Error) => {
    setShowPaymentForm(false)
    setPaymentFailed(true)
  }

  const handleActivationSuccess = async () => {
    setPaymentSuccess(true)
    await refetch()
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

  const handleCancelPlan = async () => {
    const purchase = activePurchase
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

    try {
      await cancelRenewal({ purchaseRef: purchase.reference, reason: 'User requested cancellation' })
      router.push('/')
    } catch (err) {
      console.error('Cancel failed:', err)
    }
  }

  const handleReactivate = async () => {
    const purchase = purchaseStatus.cancelledPurchase
    if (!purchase) return

    try {
      await reactivateRenewal({ purchaseRef: purchase.reference })
    } catch (err) {
      console.error('Reactivate failed:', err)
    }
  }

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

            {(loading || !isSelectionReady) && !error && (
              <div className="text-center py-8 text-slate-500">Loading pricing...</div>
            )}

            {error && !loading && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
                {error.message}
              </div>
            )}

            {isSelectionReady && !loading && !error && plans.length > 0 && currentPlan && currentPlan.reference && (
              <>
                {!showPaymentForm && !showActivation && (
                  <>
                    <PlanSelectionSection
                      plans={plans}
                      selectedPlanIndex={selectedPlanIndex}
                      activePlanIndex={activePlanIdx}
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
                      isOnActivePlan={isOnActivePlan}
                      isUsageBased={activePurchase?.planSnapshot?.planType === 'usage-based'}
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
