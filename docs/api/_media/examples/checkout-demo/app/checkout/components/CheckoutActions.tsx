interface CheckoutActionsProps {
  hasPaidSubscription: boolean;
  shouldShowCancelledNotice: boolean;
  onContinue: () => void;
  onCancel: () => void;
  isPreparingCheckout: boolean;
  isCancelling: boolean;
  className?: string;
}

/**
 * Checkout Actions Component
 * 
 * Renders Continue or Cancel Plan buttons based on subscription state
 */
export function CheckoutActions({
  hasPaidSubscription,
  shouldShowCancelledNotice,
  onContinue,
  onCancel,
  isPreparingCheckout,
  isCancelling,
  className = '',
}: CheckoutActionsProps) {
  const showCancelButton = hasPaidSubscription && !shouldShowCancelledNotice;

  if (showCancelButton) {
    return (
      <button
        onClick={onCancel}
        disabled={isCancelling}
        className={`w-full py-3 border-2 border-slate-300 text-slate-900 rounded-lg hover:border-red-500 hover:text-red-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {isCancelling ? 'Cancelling...' : 'Cancel Plan'}
      </button>
    );
  }

  return (
    <button
      onClick={onContinue}
      disabled={isPreparingCheckout}
      className={`w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {isPreparingCheckout ? (
        <span className="flex items-center justify-center gap-2">
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
          Preparing checkout...
        </span>
      ) : (
        'Continue'
      )}
    </button>
  );
}

