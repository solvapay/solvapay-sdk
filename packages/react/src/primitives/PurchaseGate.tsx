'use client'

/**
 * PurchaseGate compound primitive.
 *
 * Controls access to gated content based on whether the customer has an
 * active purchase (optionally scoped to a product). `Root` exposes
 * `data-state=allowed|blocked|loading` and context-drives the
 * `Allowed`, `Blocked`, `Loading`, and `Error` subcomponents.
 */

import React, {
  createContext,
  forwardRef,
  useContext,
  useMemo,
} from 'react'
import { Slot } from './slot'
import { usePurchase } from '../hooks/usePurchase'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'

type GateState = 'allowed' | 'blocked' | 'loading'

type PurchaseGateContextValue = {
  state: GateState
  loading: boolean
  hasAccess: boolean
  error: Error | null
}

const PurchaseGateContext = createContext<PurchaseGateContextValue | null>(null)

function useGateCtx(part: string): PurchaseGateContextValue {
  const ctx = useContext(PurchaseGateContext)
  if (!ctx) {
    throw new Error(`PurchaseGate.${part} must be rendered inside <PurchaseGate.Root>.`)
  }
  return ctx
}

type RootProps = {
  /** Require an active purchase for this product (e.g. "prd_abc"). */
  productRef?: string
  /** Require an active purchase for this specific plan (e.g. "pln_premium"). */
  planRef?: string
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>

const Root = forwardRef<HTMLDivElement, RootProps>(function PurchaseGateRoot(
  { productRef, planRef, asChild, children, ...rest },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('PurchaseGate')

  const { loading, hasPurchase, error } = usePurchase()

  const hasAccess = useMemo(
    () => hasPurchase({ productRef, planRef }),
    [hasPurchase, productRef, planRef],
  )

  const state: GateState = loading ? 'loading' : hasAccess ? 'allowed' : 'blocked'

  const ctx = useMemo<PurchaseGateContextValue>(
    () => ({ state, loading, hasAccess, error }),
    [state, loading, hasAccess, error],
  )

  const Comp = asChild ? Slot : 'div'
  return (
    <PurchaseGateContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        data-solvapay-purchase-gate=""
        data-state={state}
        {...rest}
      >
        {children}
      </Comp>
    </PurchaseGateContext.Provider>
  )
})

type SlotProps = React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }

const Allowed = forwardRef<HTMLDivElement, SlotProps>(function PurchaseGateAllowed(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Allowed')
  if (ctx.state !== 'allowed') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-purchase-gate-allowed="" {...rest}>
      {children}
    </Comp>
  )
})

const Blocked = forwardRef<HTMLDivElement, SlotProps>(function PurchaseGateBlocked(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Blocked')
  if (ctx.state !== 'blocked') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-purchase-gate-blocked="" {...rest}>
      {children}
    </Comp>
  )
})

const Loading = forwardRef<HTMLDivElement, SlotProps>(function PurchaseGateLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Loading')
  if (ctx.state !== 'loading') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-purchase-gate-loading="" {...rest}>
      {children}
    </Comp>
  )
})

const ErrorSlot = forwardRef<HTMLDivElement, SlotProps>(function PurchaseGateError(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Error')
  if (!ctx.error) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-purchase-gate-error="" role="alert" {...rest}>
      {children ?? ctx.error.message}
    </Comp>
  )
})

export const PurchaseGateRoot = Root
export const PurchaseGateAllowed = Allowed
export const PurchaseGateBlocked = Blocked
export const PurchaseGateLoading = Loading
export const PurchaseGateError = ErrorSlot

export const PurchaseGate = {
  Root,
  Allowed,
  Blocked,
  Loading,
  Error: ErrorSlot,
} as const

export function usePurchaseGate(): PurchaseGateContextValue {
  return useGateCtx('usePurchaseGate')
}
