'use client'

/**
 * CancelledPlanNotice compound primitive.
 *
 * Banner surfaced when the customer has a cancelled-but-still-active
 * purchase. `Root` renders `null` when no cancelled purchase exists;
 * otherwise it emits `data-state=active|expired` and `data-has-reason`,
 * and all leaves render only their respective slice of the cancellation
 * data (Expires, DaysRemaining, AccessUntil, CancelledOn, Reason).
 * `ReactivateButton` wires up `usePurchaseActions().reactivateRenewal`
 * with `data-state=idle|reactivating`.
 */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { usePurchaseStatus } from '../hooks/usePurchaseStatus'
import { usePurchaseActions } from '../hooks/usePurchaseActions'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { PurchaseInfo } from '../types'

type NoticeState = 'active' | 'expired'

type CancelledPlanNoticeContextValue = {
  purchase: PurchaseInfo
  state: NoticeState
  daysRemaining: number | null
  hasReason: boolean
  formatDate: (date?: string) => string | null
  reactivate: () => Promise<void>
  isReactivating: boolean
}

const CancelledPlanNoticeContext = createContext<CancelledPlanNoticeContextValue | null>(null)

function useNoticeCtx(part: string): CancelledPlanNoticeContextValue {
  const ctx = useContext(CancelledPlanNoticeContext)
  if (!ctx) {
    throw new Error(
      `CancelledPlanNotice.${part} must be rendered inside <CancelledPlanNotice.Root>.`,
    )
  }
  return ctx
}

type RootProps = {
  onReactivated?: () => void
  onError?: (error: Error) => void
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onError'>

const Root = forwardRef<HTMLDivElement, RootProps>(function CancelledPlanNoticeRoot(
  { onReactivated, onError, asChild, children, ...rest },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('CancelledPlanNotice')

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

  const daysRemaining = useMemo(
    () => (cancelledPurchase ? getDaysUntilExpiration(cancelledPurchase.endDate) : null),
    [cancelledPurchase, getDaysUntilExpiration],
  )

  const ctx = useMemo<CancelledPlanNoticeContextValue | null>(() => {
    if (!cancelledPurchase) return null
    const state: NoticeState =
      daysRemaining != null && daysRemaining > 0 ? 'active' : 'expired'
    return {
      purchase: cancelledPurchase,
      state,
      daysRemaining,
      hasReason: !!cancelledPurchase.cancellationReason,
      formatDate,
      reactivate,
      isReactivating,
    }
  }, [cancelledPurchase, daysRemaining, formatDate, reactivate, isReactivating])

  if (!shouldShowCancelledNotice || !ctx) return null

  const Comp = asChild ? Slot : 'div'
  return (
    <CancelledPlanNoticeContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        data-solvapay-cancelled-notice=""
        data-state={ctx.state}
        data-has-reason={ctx.hasReason ? '' : undefined}
        {...rest}
      >
        {children}
      </Comp>
    </CancelledPlanNoticeContext.Provider>
  )
})

type LeafProps = React.HTMLAttributes<HTMLElement> & { asChild?: boolean }

const Heading = forwardRef<HTMLParagraphElement, LeafProps>(function CancelledPlanNoticeHeading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  useNoticeCtx('Heading')
  const copy = useCopy()
  const Comp = asChild ? Slot : 'p'
  return (
    <Comp ref={forwardedRef} data-solvapay-cancelled-notice-heading="" {...rest}>
      {children ?? copy.cancelledNotice.heading}
    </Comp>
  )
})

const Expires = forwardRef<HTMLParagraphElement, LeafProps>(function CancelledPlanNoticeExpires(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useNoticeCtx('Expires')
  const copy = useCopy()
  const date = ctx.formatDate(ctx.purchase.endDate)
  if (!ctx.purchase.endDate) {
    const Comp = asChild ? Slot : 'p'
    return (
      <Comp ref={forwardedRef} data-solvapay-cancelled-notice-expires="" {...rest}>
        {children ?? copy.cancelledNotice.accessEnded}
      </Comp>
    )
  }
  const Comp = asChild ? Slot : 'p'
  return (
    <Comp ref={forwardedRef} data-solvapay-cancelled-notice-expires="" {...rest}>
      {children ?? interpolate(copy.cancelledNotice.expiresLabel, { date: date ?? '' })}
    </Comp>
  )
})

const DaysRemaining = forwardRef<HTMLParagraphElement, LeafProps>(
  function CancelledPlanNoticeDaysRemaining({ asChild, children, ...rest }, forwardedRef) {
    const ctx = useNoticeCtx('DaysRemaining')
    const copy = useCopy()
    if (ctx.daysRemaining == null || ctx.daysRemaining <= 0) return null
    const template =
      ctx.daysRemaining === 1
        ? copy.cancelledNotice.dayRemaining
        : copy.cancelledNotice.daysRemaining
    const Comp = asChild ? Slot : 'p'
    return (
      <Comp ref={forwardedRef} data-solvapay-cancelled-notice-days-remaining="" {...rest}>
        {children ?? interpolate(template, { days: ctx.daysRemaining })}
      </Comp>
    )
  },
)

const AccessUntil = forwardRef<HTMLParagraphElement, LeafProps>(
  function CancelledPlanNoticeAccessUntil({ asChild, children, ...rest }, forwardedRef) {
    const ctx = useNoticeCtx('AccessUntil')
    const copy = useCopy()
    if (!ctx.purchase.endDate) return null
    const Comp = asChild ? Slot : 'p'
    return (
      <Comp ref={forwardedRef} data-solvapay-cancelled-notice-access-until="" {...rest}>
        {children ??
          interpolate(copy.cancelledNotice.accessUntil, {
            product: ctx.purchase.productName,
          })}
      </Comp>
    )
  },
)

const CancelledOn = forwardRef<HTMLParagraphElement, LeafProps>(
  function CancelledPlanNoticeCancelledOn({ asChild, children, ...rest }, forwardedRef) {
    const ctx = useNoticeCtx('CancelledOn')
    const copy = useCopy()
    if (!ctx.purchase.cancelledAt) return null
    const date = ctx.formatDate(ctx.purchase.cancelledAt)
    const Comp = asChild ? Slot : 'p'
    return (
      <Comp ref={forwardedRef} data-solvapay-cancelled-notice-cancelled-on="" {...rest}>
        {children ?? interpolate(copy.cancelledNotice.cancelledOn, { date: date ?? '' })}
      </Comp>
    )
  },
)

const Reason = forwardRef<HTMLSpanElement, LeafProps>(function CancelledPlanNoticeReason(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useNoticeCtx('Reason')
  if (!ctx.hasReason) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-cancelled-notice-reason="" {...rest}>
      {children ?? ctx.purchase.cancellationReason}
    </Comp>
  )
})

type ReactivateButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const ReactivateButton = forwardRef<HTMLButtonElement, ReactivateButtonProps>(
  function CancelledPlanNoticeReactivateButton(
    { asChild, onClick, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useNoticeCtx('ReactivateButton')
    const copy = useCopy()
    const disabled = ctx.isReactivating

    const commonProps = {
      'data-solvapay-cancelled-notice-reactivate': '',
      'data-state': ctx.isReactivating ? 'reactivating' : 'idle',
      'aria-busy': ctx.isReactivating,
      'aria-disabled': disabled || undefined,
      disabled,
      onClick: composeEventHandlers(onClick, () => {
        void ctx.reactivate()
      }),
      ...rest,
    } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

    const label = ctx.isReactivating
      ? copy.cancelledNotice.reactivateButtonLoading
      : copy.cancelledNotice.reactivateButton

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

export const CancelledPlanNoticeRoot = Root
export const CancelledPlanNoticeHeading = Heading
export const CancelledPlanNoticeExpires = Expires
export const CancelledPlanNoticeDaysRemaining = DaysRemaining
export const CancelledPlanNoticeAccessUntil = AccessUntil
export const CancelledPlanNoticeCancelledOn = CancelledOn
export const CancelledPlanNoticeReason = Reason
export const CancelledPlanNoticeReactivateButton = ReactivateButton

export const CancelledPlanNotice = {
  Root,
  Heading,
  Expires,
  DaysRemaining,
  AccessUntil,
  CancelledOn,
  Reason,
  ReactivateButton,
} as const

export function useCancelledPlanNotice(): CancelledPlanNoticeContextValue {
  return useNoticeCtx('useCancelledPlanNotice')
}
