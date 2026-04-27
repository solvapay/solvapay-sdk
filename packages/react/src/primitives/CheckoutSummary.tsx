'use client'

/**
 * CheckoutSummary compound primitive.
 *
 * Unstyled, accessible building blocks for rendering a checkout-time summary
 * of the selected plan + product. Consumers compose subcomponents; the
 * top-level `@solvapay/react` package ships a thin default-tree shim in
 * `src/components/CheckoutSummary.tsx`.
 *
 * Every leaf subcomponent accepts `asChild` for Slot-style composition with
 * consumer elements (shadcn/ui, Tailwind, plain HTML). State comes from
 * `usePlan` + `useProduct` with optional fallback through
 * `PlanSelectionContext`.
 */

import React, { createContext, forwardRef, useContext, useMemo } from 'react'
import { Slot } from './slot'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useCopy, useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'
import { interpolate } from '../i18n/interpolate'
import { usePlanSelection } from '../components/PlanSelectionContext'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { Plan, Product } from '../types'

type CheckoutSummaryContextValue = {
  plan: Plan | null
  product: Product | null
  priceFormatted: string
  trialBanner: string | null
  loading: boolean
}

const CheckoutSummaryContext = createContext<CheckoutSummaryContextValue | null>(null)

function useCheckoutSummaryContext(part: string): CheckoutSummaryContextValue {
  const ctx = useContext(CheckoutSummaryContext)
  if (!ctx) {
    throw new Error(
      `CheckoutSummary.${part} must be rendered inside <CheckoutSummary.Root>.`,
    )
  }
  return ctx
}

type RootProps = {
  planRef?: string
  productRef?: string
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>

const Root = forwardRef<HTMLDivElement, RootProps>(function CheckoutSummaryRoot(
  { planRef, productRef, asChild, children, ...rest },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('CheckoutSummary')

  const locale = useLocale()
  const copy = useCopy()
  const planSelection = usePlanSelection()

  const resolvedPlanRef = planRef ?? planSelection?.selectedPlanRef ?? undefined
  const resolvedProductRef = productRef ?? planSelection?.productRef

  const { plan, loading: planLoading } = usePlan({
    planRef: resolvedPlanRef,
    productRef: resolvedProductRef,
  })
  const { product, loading: productLoading } = useProduct(resolvedProductRef)

  const loading = planLoading || productLoading

  const priceFormatted = useMemo(() => {
    const price = plan?.price ?? 0
    const currency = plan?.currency ?? 'usd'
    return formatPrice(price, currency, {
      locale,
      interval: plan?.interval,
      intervalCount: 1,
      free: copy.interval.free,
    })
  }, [plan, locale, copy.interval.free])

  const trialBanner = useMemo(() => {
    const trialDays = plan?.trialDays
    if (!trialDays || trialDays <= 0) return null
    return interpolate(copy.interval.trial, { trialDays })
  }, [plan?.trialDays, copy.interval.trial])

  const ctx = useMemo<CheckoutSummaryContextValue>(
    () => ({ plan, product, priceFormatted, trialBanner, loading }),
    [plan, product, priceFormatted, trialBanner, loading],
  )

  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary="" {...rest}>
      <CheckoutSummaryContext.Provider value={ctx}>
        {children}
      </CheckoutSummaryContext.Provider>
    </Comp>
  )
})

type LeafProps = React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }

const ProductSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryProduct(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Product')
  const name = ctx.product?.name
  if (!name) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-product="" {...rest}>
      {children ?? name}
    </Comp>
  )
})

const PlanSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryPlan(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Plan')
  const name = ctx.plan?.name
  if (!name) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-plan="" {...rest}>
      {children ?? name}
    </Comp>
  )
})

const PriceSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryPrice(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Price')
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-price="" {...rest}>
      {children ?? ctx.priceFormatted}
    </Comp>
  )
})

const TrialSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryTrial(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Trial')
  if (!ctx.trialBanner) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-trial="" {...rest}>
      {children ?? ctx.trialBanner}
    </Comp>
  )
})

const TaxNoteSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryTaxNote(
  { asChild, children, ...rest },
  forwardedRef,
) {
  useCheckoutSummaryContext('TaxNote')
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-tax-note="" {...rest}>
      {children ?? 'Taxes calculated at checkout'}
    </Comp>
  )
})

export const CheckoutSummaryRoot = Root
export const CheckoutSummaryProduct = ProductSlot
export const CheckoutSummaryPlan = PlanSlot
export const CheckoutSummaryPrice = PriceSlot
export const CheckoutSummaryTrial = TrialSlot
export const CheckoutSummaryTaxNote = TaxNoteSlot

export const CheckoutSummary = {
  Root,
  Product: ProductSlot,
  Plan: PlanSlot,
  Price: PriceSlot,
  Trial: TrialSlot,
  TaxNote: TaxNoteSlot,
} as const

/**
 * Hook for consumers who need the resolved plan/product/price state directly
 * (for example, to gate sibling UI outside the primitive tree).
 *
 * Must be called inside `<CheckoutSummary.Root>`.
 */
export function useCheckoutSummary(): CheckoutSummaryContextValue {
  return useCheckoutSummaryContext('useCheckoutSummary')
}
