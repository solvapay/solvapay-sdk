'use client'

/**
 * Default-tree shim over the `CancelledPlanNotice` primitive.
 *
 * Renders the full cancellation banner (heading, expiry, days remaining,
 * access-until, cancellation date, reason, reactivate CTA) when the
 * customer has a cancelled-but-still-active purchase. Renders `null`
 * otherwise.
 */

import React from 'react'
import { CancelledPlanNotice as Primitive } from '../primitives/CancelledPlanNotice'

export interface CancelledPlanNoticeProps {
  onReactivated?: () => void
  onError?: (error: Error) => void
  className?: string
}

export const CancelledPlanNotice: React.FC<CancelledPlanNoticeProps> = ({
  onReactivated,
  onError,
  className,
}) => {
  const rootClass = ['solvapay-cancelled-notice', className].filter(Boolean).join(' ')
  return (
    <Primitive.Root
      onReactivated={onReactivated}
      onError={onError}
      className={rootClass}
    >
      <Primitive.Heading className="solvapay-cancelled-notice-heading" />
      <div className="solvapay-cancelled-notice-details">
        <Primitive.Expires className="solvapay-cancelled-notice-expires" />
        <Primitive.DaysRemaining className="solvapay-cancelled-notice-days-remaining" />
        <Primitive.AccessUntil className="solvapay-cancelled-notice-access-until" />
      </div>
      <div className="solvapay-cancelled-notice-footer">
        <Primitive.CancelledOn className="solvapay-cancelled-notice-cancelled-on" />
        <Primitive.Reason className="solvapay-cancelled-notice-reason" />
      </div>
      <Primitive.ReactivateButton className="solvapay-cancelled-notice-reactivate" />
    </Primitive.Root>
  )
}
