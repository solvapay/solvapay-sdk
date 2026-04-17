'use client'

/**
 * CancelPlanButton leaf primitive.
 *
 * Cancels the active (or specified) purchase via `usePurchaseActions`.
 * Emits `data-state=idle|cancelling` and auto-derives the confirm dialog
 * copy from the plan type (`recurring` vs. `usage-based`) unless overridden
 * via the `confirm` prop (`false` to skip, string to replace).
 */

import React, { forwardRef, useCallback, useContext } from 'react'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { usePurchase } from '../hooks/usePurchase'
import { usePurchaseActions } from '../hooks/usePurchaseActions'
import { useCopy } from '../hooks/useCopy'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { PurchaseInfo } from '../types'

type CancelState = 'idle' | 'cancelling'

type CancelPlanButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  /** Defaults to the active purchase from `usePurchase()`. */
  purchaseRef?: string
  reason?: string
  /**
   * Built-in confirm dialog. `true` (default) uses plan-type-aware copy;
   * a string replaces the copy; `false` skips confirmation.
   */
  confirm?: boolean | string
  onCancelled?: () => void
  onError?: (error: Error) => void
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

export const CancelPlanButton = forwardRef<HTMLButtonElement, CancelPlanButtonProps>(
  function CancelPlanButton(
    {
      asChild,
      purchaseRef,
      reason,
      confirm = true,
      onCancelled,
      onError,
      onClick,
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const solva = useContext(SolvaPayContext)
    if (!solva) throw new MissingProviderError('CancelPlanButton')

    const copy = useCopy()
    const { activePurchase } = usePurchase()
    const { cancelRenewal, isCancelling } = usePurchaseActions()

    const effectivePurchase: PurchaseInfo | null = purchaseRef
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
    const state: CancelState = isCancelling ? 'cancelling' : 'idle'

    const commonProps = {
      'data-solvapay-cancel-plan': '',
      'data-state': state,
      'aria-busy': isCancelling,
      'aria-disabled': disabled || undefined,
      disabled,
      onClick: composeEventHandlers(onClick, () => {
        void cancel()
      }),
      ...rest,
    } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

    const label = isCancelling ? copy.cancelPlan.buttonLoading : copy.cancelPlan.button

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
          {children ?? <>{label}</>}
        </Slot>
      )
    }
    return (
      <button ref={forwardedRef} type="button" {...commonProps}>
        {children ?? label}
      </button>
    )
  },
)
