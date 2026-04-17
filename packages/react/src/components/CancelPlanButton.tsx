'use client'
import React, { useCallback } from 'react'
import { usePurchase } from '../hooks/usePurchase'
import { usePurchaseActions } from '../hooks/usePurchaseActions'
import { useCopy } from '../hooks/useCopy'
import type { PurchaseInfo } from '../types'

export interface CancelPlanButtonClassNames {
  button?: string
  buttonLoading?: string
}

export interface CancelPlanButtonRenderArgs {
  cancel: () => Promise<void>
  isCancelling: boolean
  disabled: boolean
  purchase: PurchaseInfo | null
}

export interface CancelPlanButtonProps {
  /** Defaults to the active purchase from `usePurchase()`. */
  purchaseRef?: string
  /** Optional cancellation reason forwarded to the API. */
  reason?: string
  onCancelled?: () => void
  onError?: (error: Error) => void
  /**
   * Built-in confirm dialog. `true` (default) uses the plan-type-aware copy;
   * passing a string replaces the copy; `false` skips confirmation entirely.
   */
  confirm?: boolean | string
  classNames?: CancelPlanButtonClassNames
  className?: string
  children?: (args: CancelPlanButtonRenderArgs) => React.ReactNode
}

function resolveConfirmText(
  confirm: boolean | string,
  purchase: PurchaseInfo | null,
  defaults: { recurring: string; usageBased: string },
): string | null {
  if (confirm === false) return null
  if (typeof confirm === 'string') return confirm
  const planType = purchase?.planSnapshot?.planType
  if (planType === 'usage-based') return defaults.usageBased
  return defaults.recurring
}

/**
 * Cancels the active (or specified) purchase with a built-in confirm dialog,
 * loading state, and plan-type-aware default copy. Exposes a render-prop for
 * fully custom UI.
 */
export const CancelPlanButton: React.FC<CancelPlanButtonProps> = ({
  purchaseRef,
  reason,
  onCancelled,
  onError,
  confirm = true,
  classNames = {},
  className,
  children,
}) => {
  const copy = useCopy()
  const { activePurchase } = usePurchase()
  const { cancelRenewal, isCancelling } = usePurchaseActions()

  const effectivePurchase = purchaseRef
    ? activePurchase && activePurchase.reference === purchaseRef
      ? activePurchase
      : ({ reference: purchaseRef } as PurchaseInfo)
    : activePurchase

  const effectiveRef = purchaseRef ?? effectivePurchase?.reference

  const cancel = useCallback(async () => {
    if (!effectiveRef) return
    const confirmText = resolveConfirmText(confirm, effectivePurchase, {
      recurring: copy.cancelPlan.confirmRecurring,
      usageBased: copy.cancelPlan.confirmUsageBased,
    })
    if (confirmText && typeof window !== 'undefined' && !window.confirm(confirmText)) {
      return
    }
    try {
      await cancelRenewal({ purchaseRef: effectiveRef, reason })
      onCancelled?.()
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }, [effectiveRef, effectivePurchase, confirm, copy, cancelRenewal, reason, onCancelled, onError])

  const disabled = isCancelling || !effectiveRef

  if (children) {
    return (
      <>
        {children({
          cancel,
          isCancelling,
          disabled,
          purchase: effectivePurchase,
        })}
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={cancel}
      disabled={disabled}
      data-solvapay-cancel-plan=""
      className={className ?? (isCancelling ? classNames.buttonLoading : classNames.button)}
      aria-busy={isCancelling}
    >
      {isCancelling ? copy.cancelPlan.buttonLoading : copy.cancelPlan.button}
    </button>
  )
}
