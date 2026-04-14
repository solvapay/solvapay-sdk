import type { PurchaseInfo } from '@solvapay/react'
import { formatDate, getDaysUntilExpiration } from '../utils/dateHelpers'

interface PurchaseNoticesProps {
  cancelledPurchase: PurchaseInfo | null
  shouldShow: boolean
  onReactivate?: () => void
  isReactivating?: boolean
  className?: string
}

export function PurchaseNotices({
  cancelledPurchase,
  shouldShow,
  onReactivate,
  isReactivating = false,
  className = '',
}: PurchaseNoticesProps) {
  if (!shouldShow || !cancelledPurchase) return null

  const daysLeft = getDaysUntilExpiration(cancelledPurchase.endDate)

  return (
    <div className={`p-4 bg-amber-50 border border-amber-200 rounded-lg ${className}`}>
      <div className="flex items-start">
        <svg
          className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 mb-2">
            Your purchase has been cancelled
          </p>
          {cancelledPurchase.endDate ? (
            <div className="mt-2 p-2 bg-white rounded border border-amber-300">
              <p className="text-sm font-semibold text-amber-900">
                ⏰ Purchase Expires: {formatDate(cancelledPurchase.endDate)}
              </p>
              {daysLeft !== null && daysLeft > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                </p>
              )}
              <p className="text-xs text-amber-700 mt-1">
                You'll continue to have access to {cancelledPurchase.productName} features until
                this date
              </p>
            </div>
          ) : (
            <p className="text-sm text-amber-700 mt-1">Your purchase access has ended</p>
          )}
          {cancelledPurchase.cancelledAt && (
            <p className="text-xs text-amber-600 mt-2">
              Cancelled on {formatDate(cancelledPurchase.cancelledAt)}
              {cancelledPurchase.cancellationReason &&
                ` - ${cancelledPurchase.cancellationReason}`}
            </p>
          )}
          {onReactivate && (
            <button
              onClick={onReactivate}
              disabled={isReactivating}
              className="mt-3 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isReactivating ? 'Reactivating...' : 'Undo Cancellation'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
