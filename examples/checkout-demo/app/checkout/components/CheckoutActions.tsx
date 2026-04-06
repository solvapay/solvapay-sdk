import { Button } from '../../components/ui/Button'

interface CheckoutActionsProps {
  isOnActivePlan: boolean
  isUsageBased: boolean
  shouldShowCancelledNotice: boolean
  onContinue: () => void
  onCancel: () => void
  isPreparingCheckout: boolean
  isCancelling: boolean
  className?: string
}

export function CheckoutActions({
  isOnActivePlan,
  isUsageBased,
  shouldShowCancelledNotice,
  onContinue,
  onCancel,
  isPreparingCheckout,
  isCancelling,
  className = '',
}: CheckoutActionsProps) {
  if (!isOnActivePlan) {
    return (
      <Button
        variant="action"
        onClick={onContinue}
        isLoading={isPreparingCheckout}
        loadingText="Preparing checkout..."
        className={className}
      >
        Continue
      </Button>
    )
  }

  const showCancelButton = !shouldShowCancelledNotice

  if (showCancelButton) {
    const cancelLabel = isUsageBased ? 'Deactivate Plan' : 'Cancel Plan'
    const cancellingLabel = isUsageBased ? 'Deactivating...' : 'Cancelling...'

    return (
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={isCancelling}
        className={className}
      >
        {isCancelling ? cancellingLabel : cancelLabel}
      </Button>
    )
  }

  return (
    <Button
      variant="action"
      onClick={onContinue}
      isLoading={isPreparingCheckout}
      loadingText="Preparing checkout..."
      className={className}
    >
      Continue
    </Button>
  )
}
