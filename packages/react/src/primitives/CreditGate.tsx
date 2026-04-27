'use client'

/**
 * CreditGate compound primitive.
 *
 * Companion to `<PurchaseGate>` for usage-based flows. `Root` compares the
 * customer's credit balance against a threshold and drives
 * `data-state=allowed|blocked|loading`. Subcomponents render only in their
 * matching state:
 *  - `Heading`, `Subheading`, `Topup` — `blocked`
 *  - `Loading` — `loading`
 *  - `Error` — when `useBalance()` reports a fetch error
 *
 * Consumer-rendered "allowed" content is gated via the `useCreditGate()`
 * hook or by conditionally mounting children.
 */

import React, {
  createContext,
  forwardRef,
  useContext,
  useMemo,
} from 'react'
import { Slot } from './slot'
import { useBalance } from '../hooks/useBalance'
import { useProduct } from '../hooks/useProduct'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { TopupForm as TopupFormShim } from '../TopupForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'

type GateState = 'allowed' | 'blocked' | 'loading'

type CreditGateContextValue = {
  state: GateState
  loading: boolean
  hasCredits: boolean
  balance: number | null
  productName: string | null
  topupAmount: number
  topupCurrency: string
}

const CreditGateContext = createContext<CreditGateContextValue | null>(null)

function useGateCtx(part: string): CreditGateContextValue {
  const ctx = useContext(CreditGateContext)
  if (!ctx) {
    throw new Error(`CreditGate.${part} must be rendered inside <CreditGate.Root>.`)
  }
  return ctx
}

type RootProps = {
  minCredits?: number
  productRef?: string
  topupAmount?: number
  topupCurrency?: string
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>

const Root = forwardRef<HTMLDivElement, RootProps>(function CreditGateRoot(
  {
    minCredits = 1,
    productRef,
    topupAmount = 1000,
    topupCurrency = 'usd',
    asChild,
    children,
    ...rest
  },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('CreditGate')

  const { credits, loading } = useBalance()
  const { product } = useProduct(productRef)

  const hasCredits = credits != null && credits >= minCredits
  const state: GateState = loading && credits == null ? 'loading' : hasCredits ? 'allowed' : 'blocked'

  const ctx = useMemo<CreditGateContextValue>(
    () => ({
      state,
      loading,
      hasCredits,
      balance: credits,
      productName: product?.name ?? null,
      topupAmount,
      topupCurrency,
    }),
    [state, loading, hasCredits, credits, product?.name, topupAmount, topupCurrency],
  )

  const Comp = asChild ? Slot : 'div'
  return (
    <CreditGateContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        data-solvapay-credit-gate=""
        data-state={state}
        {...rest}
      >
        {children}
      </Comp>
    </CreditGateContext.Provider>
  )
})

type LeafProps = React.HTMLAttributes<HTMLElement> & { asChild?: boolean }

const Heading = forwardRef<HTMLHeadingElement, LeafProps>(function CreditGateHeading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Heading')
  const copy = useCopy()
  if (ctx.state !== 'blocked') return null
  const Comp = asChild ? Slot : 'h3'
  return (
    <Comp ref={forwardedRef} data-solvapay-credit-gate-heading="" {...rest}>
      {children ?? copy.creditGate.lowBalanceHeading}
    </Comp>
  )
})

const Subheading = forwardRef<HTMLParagraphElement, LeafProps>(function CreditGateSubheading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Subheading')
  const copy = useCopy()
  if (ctx.state !== 'blocked') return null
  const text = interpolate(copy.creditGate.lowBalanceSubheading, {
    product: ctx.productName ?? 'this product',
  })
  const Comp = asChild ? Slot : 'p'
  return (
    <Comp ref={forwardedRef} data-solvapay-credit-gate-subheading="" {...rest}>
      {children ?? text}
    </Comp>
  )
})

type TopupProps = {
  amount?: number
  currency?: string
}

const Topup: React.FC<TopupProps> = ({ amount, currency }) => {
  const ctx = useGateCtx('Topup')
  if (ctx.state !== 'blocked') return null
  return (
    <TopupFormShim
      amount={amount ?? ctx.topupAmount}
      currency={currency ?? ctx.topupCurrency}
    />
  )
}

const Loading = forwardRef<HTMLDivElement, LeafProps>(function CreditGateLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useGateCtx('Loading')
  if (ctx.state !== 'loading') return null
  const Comp = asChild ? Slot : 'div'
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Comp ref={forwardedRef as any} data-solvapay-credit-gate-loading="" {...rest}>
      {children}
    </Comp>
  )
})

const ErrorSlot = forwardRef<HTMLDivElement, LeafProps>(function CreditGateError(
  { asChild, children, ...rest },
  forwardedRef,
) {
  // CreditGate doesn't surface balance errors from the context today, but we
  // expose the slot for parity with other gates. Renders only when children
  // are supplied so default trees stay quiet.
  if (!children) return null
  const Comp = asChild ? Slot : 'div'
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Comp ref={forwardedRef as any} data-solvapay-credit-gate-error="" role="alert" {...rest}>
      {children}
    </Comp>
  )
})

export const CreditGateRoot = Root
export const CreditGateHeading = Heading
export const CreditGateSubheading = Subheading
export const CreditGateTopup = Topup
export const CreditGateLoading = Loading
export const CreditGateError = ErrorSlot

export const CreditGate = {
  Root,
  Heading,
  Subheading,
  Topup,
  Loading,
  Error: ErrorSlot,
} as const

export function useCreditGate(): CreditGateContextValue {
  return useGateCtx('useCreditGate')
}
