import type { SubscriptionInfo } from '@solvapay/react'
import { formatDate, getDaysUntilExpiration } from '../utils/dateHelpers'

interface SubscriptionNoticesProps {
  cancelledSubscription: SubscriptionInfo | null
  shouldShow: boolean
  className?: string
}

/**
 * Subscription Notices Component
 *
 * Displays cancellation notices and expiration warnings
 */
export function SubscriptionNotices({
  cancelledSubscription,
  shouldShow,
  className = '',
}: SubscriptionNoticesProps) {
  if (!shouldShow || !cancelledSubscription) return null

  const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate)

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
            Your subscription has been cancelled
          </p>
          {cancelledSubscription.endDate ? (
            <div className="mt-2 p-2 bg-white rounded border border-amber-300">
              <p className="text-sm font-semibold text-amber-900">
                ⏰ Subscription Expires: {formatDate(cancelledSubscription.endDate)}
              </p>
              {daysLeft !== null && daysLeft > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                </p>
              )}
              <p className="text-xs text-amber-700 mt-1">
                You'll continue to have access to {cancelledSubscription.planName} features until
                this date
              </p>
            </div>
          ) : (
            <p className="text-sm text-amber-700 mt-1">Your subscription access has ended</p>
          )}
          {cancelledSubscription.cancelledAt && (
            <p className="text-xs text-amber-600 mt-2">
              Cancelled on {formatDate(cancelledSubscription.cancelledAt)}
              {cancelledSubscription.cancellationReason &&
                ` - ${cancelledSubscription.cancellationReason}`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
