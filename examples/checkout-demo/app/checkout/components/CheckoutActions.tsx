interface CheckoutActionsProps {
  hasPaidPurchase: boolean
  activePurchase?: { planSnapshot?: { planType?: string; reference?: string } } | null
  selectedPlanRef: string | null
  shouldShowCancelledNotice: boolean
  onContinue: () => void
  onCancel: () => void
  isPreparingCheckout: boolean
  isCancelling: boolean
  className?: string
}

export function CheckoutActions({
  hasPaidPurchase,
  activePurchase,
  selectedPlanRef,
  shouldShowCancelledNotice,
  onContinue,
  onCancel,
  isPreparingCheckout,
  isCancelling,
  className = '',
}: CheckoutActionsProps) {
  const isUsageBased = activePurchase?.planSnapshot?.planType === 'usage-based'
  const hasActivePurchase = hasPaidPurchase || (activePurchase && isUsageBased)
  const activePlanRef = activePurchase?.planSnapshot?.reference ?? null
  const isSwitchingPlan = hasActivePurchase && selectedPlanRef !== activePlanRef

  if (isSwitchingPlan) {
    return (
      <button
        onClick={onContinue}
        disabled={isPreparingCheckout}
        className={`w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
      >
        {isPreparingCheckout ? (
          <span className="flex items-center justify-center gap-2">
            <LoadingSpinner />
            Preparing checkout...
          </span>
        ) : (
          'Continue'
        )}
      </button>
    )
  }

  const showCancelButton = hasActivePurchase && !shouldShowCancelledNotice

  if (showCancelButton) {
    const cancelLabel = isUsageBased ? 'Deactivate Plan' : 'Cancel Plan'
    const cancellingLabel = isUsageBased ? 'Deactivating...' : 'Cancelling...'

    return (
      <button
        onClick={onCancel}
        disabled={isCancelling}
        className={`w-full py-3 border-2 border-slate-300 text-slate-900 rounded-lg hover:border-red-500 hover:text-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {isCancelling ? cancellingLabel : cancelLabel}
      </button>
    )
  }

  return (
    <button
      onClick={onContinue}
      disabled={isPreparingCheckout}
      className={`w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {isPreparingCheckout ? (
        <span className="flex items-center justify-center gap-2">
          <LoadingSpinner />
          Preparing checkout...
        </span>
      ) : (
        'Continue'
      )}
    </button>
  )
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
