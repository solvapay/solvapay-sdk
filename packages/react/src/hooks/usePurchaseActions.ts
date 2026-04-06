import { useState, useCallback } from 'react'
import { useSolvaPay } from './useSolvaPay'
import type { CancelResult, ReactivateResult, ActivatePlanResult } from '../types'

export interface PurchaseActions {
  cancelRenewal: (params: { purchaseRef: string; reason?: string }) => Promise<CancelResult>
  reactivateRenewal: (params: { purchaseRef: string }) => Promise<ReactivateResult>
  activatePlan: (params: {
    productRef: string
    planRef: string
  }) => Promise<ActivatePlanResult>
  isCancelling: boolean
  isReactivating: boolean
  isActivating: boolean
}

/**
 * Hook for purchase lifecycle mutations: cancel, reactivate, and activate.
 *
 * Wraps the context methods with per-operation loading states.
 * Auto-refetches purchase data on success (handled by the context methods).
 *
 * @example
 * ```tsx
 * const { cancelRenewal, reactivateRenewal, isCancelling } = usePurchaseActions()
 *
 * await cancelRenewal({ purchaseRef: purchase.reference, reason: 'User requested' })
 * ```
 */
export function usePurchaseActions(): PurchaseActions {
  const ctx = useSolvaPay()
  const [isCancelling, setIsCancelling] = useState(false)
  const [isReactivating, setIsReactivating] = useState(false)
  const [isActivating, setIsActivating] = useState(false)

  const cancelRenewal = useCallback(
    async (params: { purchaseRef: string; reason?: string }): Promise<CancelResult> => {
      setIsCancelling(true)
      try {
        return await ctx.cancelRenewal(params)
      } finally {
        setIsCancelling(false)
      }
    },
    [ctx.cancelRenewal],
  )

  const reactivateRenewal = useCallback(
    async (params: { purchaseRef: string }): Promise<ReactivateResult> => {
      setIsReactivating(true)
      try {
        return await ctx.reactivateRenewal(params)
      } finally {
        setIsReactivating(false)
      }
    },
    [ctx.reactivateRenewal],
  )

  const activatePlan = useCallback(
    async (params: { productRef: string; planRef: string }): Promise<ActivatePlanResult> => {
      setIsActivating(true)
      try {
        return await ctx.activatePlan(params)
      } finally {
        setIsActivating(false)
      }
    },
    [ctx.activatePlan],
  )

  return {
    cancelRenewal,
    reactivateRenewal,
    activatePlan,
    isCancelling,
    isReactivating,
    isActivating,
  }
}
