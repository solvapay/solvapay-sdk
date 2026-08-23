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
import type { TaxBreakdown } from '@solvapay/core'

type CheckoutSummaryContextValue = {
  plan: Plan | null
  product: Product | null
  priceFormatted: string
  trialBanner: string | null
  loading: boolean
  taxBreakdown: TaxBreakdown | null
  baseAmountMinor: number
  subtotalFormatted: string
  taxFormatted: string
  totalFormatted: string
}

const CheckoutSummaryContext = createContext<CheckoutSummaryContextValue | null>(null)

function useCheckoutSummaryContext(part: string): CheckoutSummaryContextValue {
  const ctx = useContext(CheckoutSummaryContext)
  if (!ctx) {
    throw new Error(`CheckoutSummary.${part} must be rendered inside <CheckoutSummary.Root>.`)
  }
  return ctx
}

type RootProps = {
  planRef?: string
  productRef?: string
  taxBreakdown?: TaxBreakdown | null
  baseAmountMinor?: number
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'children'>

const Root = forwardRef<HTMLElement, RootProps>(function CheckoutSummaryRoot(
  { planRef, productRef, taxBreakdown = null, baseAmountMinor = 0, asChild, children, ...rest },
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

  const taxCurrency = (taxBreakdown?.currency ?? plan?.currency ?? 'usd').toLowerCase()
  const subtotalMinor = taxBreakdown?.subtotal ?? baseAmountMinor
  const taxMinor = taxBreakdown?.taxAmount ?? 0
  const totalMinor = taxBreakdown?.total ?? baseAmountMinor

  const subtotalFormatted = formatPrice(subtotalMinor, taxCurrency, { locale })
  const taxFormatted = formatPrice(taxMinor, taxCurrency, { locale })
  const totalFormatted = formatPrice(totalMinor, taxCurrency, { locale })

  const ctx = useMemo<CheckoutSummaryContextValue>(
    () => ({
      plan,
      product,
      priceFormatted,
      trialBanner,
      loading,
      taxBreakdown,
      baseAmountMinor,
      subtotalFormatted,
      taxFormatted,
      totalFormatted,
    }),
    [
      plan,
      product,
      priceFormatted,
      trialBanner,
      loading,
      taxBreakdown,
      baseAmountMinor,
      subtotalFormatted,
      taxFormatted,
      totalFormatted,
    ],
  )

  const Comp = asChild ? Slot : 'section'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary="" {...rest}>
      <CheckoutSummaryContext.Provider value={ctx}>{children}</CheckoutSummaryContext.Provider>
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

const TaxNoteSlot = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }
>(function CheckoutSummaryTaxNote({ asChild, children, ...rest }, forwardedRef) {
  const ctx = useCheckoutSummaryContext('TaxNote')
  if (ctx.taxBreakdown) return null
  const Comp = asChild ? Slot : 'p'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-tax-note="" {...rest}>
      {children ?? 'Taxes calculated at checkout'}
    </Comp>
  )
})

const SubtotalSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummarySubtotal(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Subtotal')
  if (!ctx.taxBreakdown) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-subtotal="" {...rest}>
      {children ?? ctx.subtotalFormatted}
    </Comp>
  )
})

const TaxSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryTax(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Tax')
  if (!ctx.taxBreakdown) return null
  const Comp = asChild ? Slot : 'span'
  const { taxRate, treatment } = ctx.taxBreakdown
  const defaultLabel =
    treatment === 'reverse_charge'
      ? `VAT reverse charge (${ctx.taxFormatted})`
      : taxRate != null
        ? `Tax (${Math.round(taxRate * 100)}%)`
        : 'Tax'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-tax="" {...rest}>
      {children ?? (
        <>
          <span>{defaultLabel}</span>{' '}
          <span data-solvapay-checkout-summary-tax-amount="">{ctx.taxFormatted}</span>
        </>
      )}
    </Comp>
  )
})

const TotalSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryTotal(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Total')
  if (!ctx.taxBreakdown) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-total="" {...rest}>
      {children ?? ctx.totalFormatted}
    </Comp>
  )
})

const TaxTreatmentNoteSlot = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }
>(function CheckoutSummaryTaxTreatmentNote({ asChild, children, ...rest }, forwardedRef) {
  const ctx = useCheckoutSummaryContext('TaxTreatmentNote')
  const treatment = ctx.taxBreakdown?.treatment
  if (!treatment || treatment === 'standard') return null
  const Comp = asChild ? Slot : 'p'
  const defaultNote =
    treatment === 'reverse_charge'
      ? 'VAT reverse charge applies — you are responsible for reporting VAT in your jurisdiction.'
      : treatment === 'not_collecting'
        ? 'Tax is not collected on this purchase.'
        : null
  if (!defaultNote && !children) return null
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-tax-treatment-note="" {...rest}>
      {children ?? defaultNote}
    </Comp>
  )
})

const PriceSlot = forwardRef<HTMLSpanElement, LeafProps>(function CheckoutSummaryPrice(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useCheckoutSummaryContext('Price')
  if (ctx.taxBreakdown) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-price="" {...rest}>
      {children ?? ctx.priceFormatted}
    </Comp>
  )
})

const TrialSlot = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { asChild?: boolean }
>(function CheckoutSummaryTrial({ asChild, children, ...rest }, forwardedRef) {
  const ctx = useCheckoutSummaryContext('Trial')
  if (!ctx.trialBanner || ctx.taxBreakdown) return null
  const Comp = asChild ? Slot : 'p'
  return (
    <Comp ref={forwardedRef} data-solvapay-checkout-summary-trial="" {...rest}>
      {children ?? ctx.trialBanner}
    </Comp>
  )
})

export const CheckoutSummaryRoot = Root
export const CheckoutSummaryProduct = ProductSlot
export const CheckoutSummaryPlan = PlanSlot
export const CheckoutSummaryPrice = PriceSlot
export const CheckoutSummaryTrial = TrialSlot
export const CheckoutSummaryTaxNote = TaxNoteSlot
export const CheckoutSummarySubtotal = SubtotalSlot
export const CheckoutSummaryTax = TaxSlot
export const CheckoutSummaryTotal = TotalSlot
export const CheckoutSummaryTaxTreatmentNote = TaxTreatmentNoteSlot

export const CheckoutSummary = {
  Root,
  Product: ProductSlot,
  Plan: PlanSlot,
  Price: PriceSlot,
  Trial: TrialSlot,
  TaxNote: TaxNoteSlot,
  Subtotal: SubtotalSlot,
  Tax: TaxSlot,
  Total: TotalSlot,
  TaxTreatmentNote: TaxTreatmentNoteSlot,
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
