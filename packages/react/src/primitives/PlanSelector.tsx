'use client'

/**
 * PlanSelector compound primitive.
 *
 * Unstyled, accessible building blocks for fetching a product's active plans
 * and letting users pick one. Consumers compose subcomponents; the top-level
 * `@solvapay/react` package ships a thin default-tree shim in
 * `src/components/PlanSelector.tsx`.
 *
 * State machine lives in the existing `usePlans` hook and
 * `PlanSelectionContext`. Each `Card` emits `data-state=idle|selected|current|disabled`
 * and optional `data-free`, `data-popular`, `data-trial` flags for CSS
 * targeting without inline styles.
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
import { usePlans } from '../hooks/usePlans'
import { defaultListPlans } from '../transport/list-plans'
import { usePurchase } from '../hooks/usePurchase'
import { useCopy, useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'
import { interpolate } from '../i18n/interpolate'
import { PlanSelectionProvider } from '../components/PlanSelectionContext'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProductRefError, MissingProviderError } from '../utils/errors'
import type { Plan } from '../types'

type CardState = 'idle' | 'selected' | 'current' | 'disabled'

type PlanSelectorContextValue = {
  plans: Plan[]
  loading: boolean
  error: Error | null
  selectedPlan: Plan | null
  selectedPlanRef: string | null
  popularPlanRef: string | undefined
  currentPlanRef: string | null
  isCurrent: (ref: string) => boolean
  isFree: (ref: string) => boolean
  isPopular: (ref: string) => boolean
  select: (ref: string) => void
  /**
   * Clear the current selection so no plan is selected. Pins
   * `userHasSelected` true so auto-selection doesn't reassert.
   */
  clearSelection: () => void
}

const PlanSelectorContext = createContext<PlanSelectorContextValue | null>(null)

function usePlanSelectorContext(part: string): PlanSelectorContextValue {
  const ctx = useContext(PlanSelectorContext)
  if (!ctx) {
    throw new Error(`PlanSelector.${part} must be rendered inside <PlanSelector.Root>.`)
  }
  return ctx
}

type CardContextValue = {
  plan: Plan
  state: CardState
  isCurrent: boolean
  isFree: boolean
  isPopular: boolean
  disabled: boolean
  select: () => void
}

const CardContext = createContext<CardContextValue | null>(null)

function useCardContext(part: string): CardContextValue {
  const ctx = useContext(CardContext)
  if (!ctx) {
    throw new Error(`PlanSelector.${part} must be rendered inside <PlanSelector.Card>.`)
  }
  return ctx
}

type RootProps = {
  productRef?: string
  fetcher?: (productRef: string) => Promise<Plan[]>
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  autoSelectFirstPaid?: boolean
  initialPlanRef?: string
  currentPlanRef?: string | null
  popularPlanRef?: string
  onSelect?: (planRef: string, plan: Plan) => void
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'>

const Root = forwardRef<HTMLDivElement, RootProps>(function PlanSelectorRoot(props, forwardedRef) {
  const {
    productRef,
    fetcher,
    filter,
    sortBy,
    autoSelectFirstPaid = true,
    initialPlanRef,
    currentPlanRef,
    popularPlanRef,
    onSelect,
    children,
    ...rest
  } = props

  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('PlanSelector')
  if (!productRef) throw new MissingProductRefError('PlanSelector')

  const { _config } = solva
  const { purchases } = usePurchase()

  const effectiveFetcher = useMemo(
    () => fetcher ?? ((ref: string) => defaultListPlans(ref, _config)),
    [fetcher, _config],
  )

  const { plans, selectedPlan, selectPlan, setSelectedPlanIndex, loading, error } = usePlans({
    productRef,
    fetcher: effectiveFetcher,
    filter,
    sortBy,
    autoSelectFirstPaid,
    initialPlanRef,
  })

  const autoCurrentPlanRef = useMemo(() => {
    const active = purchases
      .filter(p => p.status === 'active')
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0]
    return active?.planSnapshot?.reference ?? null
  }, [purchases])

  const resolvedCurrentPlanRef =
    currentPlanRef === null ? null : currentPlanRef ?? autoCurrentPlanRef

  const isCurrent = useCallback(
    (ref: string) => resolvedCurrentPlanRef === ref,
    [resolvedCurrentPlanRef],
  )
  const isFree = useCallback(
    (ref: string) => plans.find(p => p.reference === ref)?.requiresPayment === false,
    [plans],
  )
  const isPopular = useCallback(
    (ref: string) => popularPlanRef === ref,
    [popularPlanRef],
  )

  const select = useCallback(
    (ref: string) => {
      const plan = plans.find(p => p.reference === ref)
      if (!plan) return
      if (plan.requiresPayment === false) return
      selectPlan(ref)
      onSelect?.(ref, plan)
    },
    [plans, selectPlan, onSelect],
  )

  // Clearing the selection pins `userHasSelected` true inside
  // `usePlans`, so auto-selection can't reassert on the next render.
  // Callers use this to back out of a mid-flow step (e.g. the
  // `← Change plan` link on `McpCheckoutView`).
  const clearSelection = useCallback(() => {
    setSelectedPlanIndex(-1)
  }, [setSelectedPlanIndex])

  const selectedPlanRef = selectedPlan?.reference ?? null

  const ctx = useMemo<PlanSelectorContextValue>(
    () => ({
      plans,
      loading,
      error,
      selectedPlan: selectedPlan ?? null,
      selectedPlanRef,
      popularPlanRef,
      currentPlanRef: resolvedCurrentPlanRef,
      isCurrent,
      isFree,
      isPopular,
      select,
      clearSelection,
    }),
    [
      plans,
      loading,
      error,
      selectedPlan,
      selectedPlanRef,
      popularPlanRef,
      resolvedCurrentPlanRef,
      isCurrent,
      isFree,
      isPopular,
      select,
      clearSelection,
    ],
  )

  return (
    <PlanSelectionProvider
      value={{
        productRef,
        selectedPlanRef,
        setSelectedPlanRef: ref => {
          if (ref) select(ref)
        },
        plans,
        loading,
        error,
      }}
    >
      <div ref={forwardedRef} data-solvapay-plan-selector="" {...rest}>
        <PlanSelectorContext.Provider value={ctx}>{children}</PlanSelectorContext.Provider>
      </div>
    </PlanSelectionProvider>
  )
})

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function PlanSelectorHeading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  usePlanSelectorContext('Heading')
  const copy = useCopy()
  const Comp = asChild ? Slot : 'h3'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-heading="" {...rest}>
      {children ?? copy.planSelector.heading}
    </Comp>
  )
})

type GridProps = {
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>

const Grid = forwardRef<HTMLDivElement, GridProps>(function PlanSelectorGrid(
  { children, ...rest },
  forwardedRef,
) {
  const ctx = usePlanSelectorContext('Grid')
  return (
    <div ref={forwardedRef} data-solvapay-plan-selector-grid="" {...rest}>
      {ctx.plans.map(plan => {
        const isCurrent = ctx.isCurrent(plan.reference)
        const isFree = ctx.isFree(plan.reference)
        const isPopular = ctx.isPopular(plan.reference)
        const selected = ctx.selectedPlanRef === plan.reference
        const disabled = isCurrent || isFree
        const state: CardState = isCurrent
          ? 'current'
          : isFree
            ? 'disabled'
            : selected
              ? 'selected'
              : 'idle'
        const cardCtx: CardContextValue = {
          plan,
          state,
          isCurrent,
          isFree,
          isPopular,
          disabled,
          select: () => ctx.select(plan.reference),
        }
        return (
          <CardContext.Provider key={plan.reference} value={cardCtx}>
            {children}
          </CardContext.Provider>
        )
      })}
    </div>
  )
})

type CardProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }

const Card = forwardRef<HTMLButtonElement, CardProps>(function PlanSelectorCard(
  { asChild, onClick, children, ...rest },
  forwardedRef,
) {
  const card = useCardContext('Card')
  const dataTrial = !!(card.plan.trialDays && card.plan.trialDays > 0)

  const commonProps: Record<string, unknown> = {
    'data-solvapay-plan-selector-card': '',
    'data-state': card.state,
    'data-free': card.isFree ? '' : undefined,
    'data-popular': card.isPopular ? '' : undefined,
    'data-trial': dataTrial ? '' : undefined,
    'aria-disabled': card.disabled || undefined,
    onClick: composeEventHandlers(onClick, () => {
      if (!card.disabled) card.select()
    }),
    ...rest,
  }

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...commonProps}>
        {children}
      </Slot>
    )
  }
  return (
    <button
      ref={forwardedRef}
      type="button"
      disabled={card.disabled}
      {...(commonProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  )
})

type LeafProps = React.HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }

const CardName = forwardRef<HTMLSpanElement, LeafProps>(function PlanSelectorCardName(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const card = useCardContext('CardName')
  if (!card.plan.name) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-card-name="" {...rest}>
      {children ?? card.plan.name}
    </Comp>
  )
})

const CardPrice = forwardRef<HTMLSpanElement, LeafProps>(function PlanSelectorCardPrice(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const card = useCardContext('CardPrice')
  const locale = useLocale()
  const copy = useCopy()
  const formatted = useMemo(() => {
    if (card.isFree) return copy.planSelector.freeBadge
    return formatPrice(card.plan.price ?? 0, card.plan.currency ?? 'usd', {
      locale,
      free: copy.interval.free,
    })
  }, [
    card.isFree,
    card.plan.price,
    card.plan.currency,
    locale,
    copy.planSelector.freeBadge,
    copy.interval.free,
  ])
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-card-price="" {...rest}>
      {children ?? formatted}
    </Comp>
  )
})

const CardInterval = forwardRef<HTMLSpanElement, LeafProps>(function PlanSelectorCardInterval(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const card = useCardContext('CardInterval')
  const copy = useCopy()
  if (card.isFree || !card.plan.interval) return null
  const text = interpolate(copy.planSelector.perIntervalShort, { interval: card.plan.interval })
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-card-interval="" {...rest}>
      {children ?? text}
    </Comp>
  )
})

type BadgeProps = LeafProps & { 'data-variant'?: 'current' | 'popular' }

const CardBadge = forwardRef<HTMLSpanElement, BadgeProps>(function PlanSelectorCardBadge(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const card = useCardContext('CardBadge')
  const copy = useCopy()

  let variant: 'current' | 'popular' | null = null
  let label = ''
  if (card.isCurrent) {
    variant = 'current'
    label = copy.planSelector.currentBadge
  } else if (card.isPopular && !card.isFree) {
    variant = 'popular'
    label = copy.planSelector.popularBadge
  }
  if (!variant) return null

  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      ref={forwardedRef}
      data-solvapay-plan-selector-card-badge=""
      data-variant={variant}
      {...rest}
    >
      {children ?? label}
    </Comp>
  )
})

type StateSlotProps = React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }

const Loading = forwardRef<HTMLDivElement, StateSlotProps>(function PlanSelectorLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = usePlanSelectorContext('Loading')
  if (!ctx.loading || ctx.plans.length > 0) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-loading="" {...rest}>
      {children}
    </Comp>
  )
})

const ErrorSlot = forwardRef<HTMLDivElement, StateSlotProps>(function PlanSelectorError(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = usePlanSelectorContext('Error')
  if (!ctx.error) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-error="" role="alert" {...rest}>
      {children ?? ctx.error.message}
    </Comp>
  )
})

export const PlanSelectorRoot = Root
export const PlanSelectorHeading = Heading
export const PlanSelectorGrid = Grid
export const PlanSelectorCard = Card
export const PlanSelectorCardName = CardName
export const PlanSelectorCardPrice = CardPrice
export const PlanSelectorCardInterval = CardInterval
export const PlanSelectorCardBadge = CardBadge
export const PlanSelectorLoading = Loading
export const PlanSelectorError = ErrorSlot

export const PlanSelector = {
  Root,
  Heading,
  Grid,
  Card,
  CardName,
  CardPrice,
  CardInterval,
  CardBadge,
  Loading,
  Error: ErrorSlot,
} as const

/**
 * Hook for reading the shared PlanSelector state inside the primitive tree.
 * Must be called under `<PlanSelector.Root>`.
 */
export function usePlanSelector(): PlanSelectorContextValue {
  return usePlanSelectorContext('usePlanSelector')
}
