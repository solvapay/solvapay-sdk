'use client'
import React, { useCallback } from 'react'
import { usePurchaseStatus } from '../hooks/usePurchaseStatus'
import { usePurchaseActions } from '../hooks/usePurchaseActions'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import type { PurchaseInfo } from '../types'

export interface CancelledPlanNoticeClassNames {
  root?: string
  heading?: string
  detailsBox?: string
  expires?: string
  daysRemaining?: string
  accessUntil?: string
  cancelledOn?: string
  reactivateButton?: string
}

export interface CancelledPlanNoticeRenderArgs {
  purchase: PurchaseInfo
  daysRemaining: number | null
  reactivate: () => Promise<void>
  isReactivating: boolean
  formatDate: (date?: string) => string | null
}

export interface CancelledPlanNoticeProps {
  onReactivated?: () => void
  onError?: (error: Error) => void
  classNames?: CancelledPlanNoticeClassNames
  className?: string
  unstyled?: boolean
  children?: (args: CancelledPlanNoticeRenderArgs) => React.ReactNode
}

const rootStyle: React.CSSProperties = {
  padding: 16,
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 8,
}

const detailsStyle: React.CSSProperties = {
  marginTop: 8,
  padding: 10,
  background: '#fff',
  border: '1px solid #fcd34d',
  borderRadius: 6,
}

/**
 * Banner surfaced when the customer has a cancelled-but-still-active
 * purchase. Shows the expiration date, days remaining, cancellation reason,
 * and a reactivate CTA. Renders nothing when there's no cancelled purchase.
 */
export const CancelledPlanNotice: React.FC<CancelledPlanNoticeProps> = ({
  onReactivated,
  onError,
  classNames = {},
  className,
  unstyled = false,
  children,
}) => {
  const copy = useCopy()
  const {
    cancelledPurchase,
    shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  } = usePurchaseStatus()
  const { reactivateRenewal, isReactivating } = usePurchaseActions()

  const reactivate = useCallback(async () => {
    if (!cancelledPurchase) return
    try {
      await reactivateRenewal({ purchaseRef: cancelledPurchase.reference })
      onReactivated?.()
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }, [cancelledPurchase, reactivateRenewal, onReactivated, onError])

  if (!shouldShowCancelledNotice || !cancelledPurchase) return null

  const daysRemaining = getDaysUntilExpiration(cancelledPurchase.endDate)

  if (children) {
    return (
      <>
        {children({
          purchase: cancelledPurchase,
          daysRemaining,
          reactivate,
          isReactivating,
          formatDate,
        })}
      </>
    )
  }

  const expiresDate = formatDate(cancelledPurchase.endDate)
  const cancelledDate = formatDate(cancelledPurchase.cancelledAt)

  return (
    <div
      data-solvapay-cancelled-notice=""
      className={className ?? classNames.root}
      style={unstyled || className || classNames.root ? undefined : rootStyle}
    >
      <p
        className={classNames.heading}
        style={
          unstyled || classNames.heading
            ? undefined
            : { fontSize: 14, fontWeight: 600, color: '#78350f', margin: 0 }
        }
      >
        {copy.cancelledNotice.heading}
      </p>

      {cancelledPurchase.endDate ? (
        <div
          className={classNames.detailsBox}
          style={unstyled || classNames.detailsBox ? undefined : detailsStyle}
        >
          <p
            className={classNames.expires}
            style={
              unstyled || classNames.expires
                ? undefined
                : { fontSize: 14, fontWeight: 600, color: '#92400e', margin: 0 }
            }
          >
            {interpolate(copy.cancelledNotice.expiresLabel, { date: expiresDate ?? '' })}
          </p>
          {daysRemaining != null && daysRemaining > 0 && (
            <p
              className={classNames.daysRemaining}
              style={
                unstyled || classNames.daysRemaining
                  ? undefined
                  : { fontSize: 12, color: '#b45309', margin: '4px 0 0' }
              }
            >
              {interpolate(
                daysRemaining === 1
                  ? copy.cancelledNotice.dayRemaining
                  : copy.cancelledNotice.daysRemaining,
                { days: daysRemaining },
              )}
            </p>
          )}
          <p
            className={classNames.accessUntil}
            style={
              unstyled || classNames.accessUntil
                ? undefined
                : { fontSize: 12, color: '#b45309', margin: '4px 0 0' }
            }
          >
            {interpolate(copy.cancelledNotice.accessUntil, {
              product: cancelledPurchase.productName,
            })}
          </p>
        </div>
      ) : (
        <p
          style={
            unstyled
              ? undefined
              : { fontSize: 14, color: '#b45309', margin: '4px 0 0' }
          }
        >
          {copy.cancelledNotice.accessEnded}
        </p>
      )}

      {cancelledPurchase.cancelledAt && (
        <p
          className={classNames.cancelledOn}
          style={
            unstyled || classNames.cancelledOn
              ? undefined
              : { fontSize: 12, color: '#a16207', margin: '8px 0 0' }
          }
        >
          {interpolate(copy.cancelledNotice.cancelledOn, { date: cancelledDate ?? '' })}
          {cancelledPurchase.cancellationReason
            ? ` - ${cancelledPurchase.cancellationReason}`
            : null}
        </p>
      )}

      <button
        type="button"
        onClick={reactivate}
        disabled={isReactivating}
        aria-busy={isReactivating}
        className={classNames.reactivateButton}
        style={
          unstyled || classNames.reactivateButton
            ? undefined
            : {
                marginTop: 12,
                padding: '8px 16px',
                background: '#0f172a',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: isReactivating ? 'not-allowed' : 'pointer',
                opacity: isReactivating ? 0.6 : 1,
              }
        }
      >
        {isReactivating
          ? copy.cancelledNotice.reactivateButtonLoading
          : copy.cancelledNotice.reactivateButton}
      </button>
    </div>
  )
}
