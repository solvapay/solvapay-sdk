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
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { isPaygPlan } from '../utils/isPayg'
import {
  getPlanPricingOptions,
  resolvePlanPricingOption,
  type PlanPricingOption,
} from '../utils/planPricing'
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
  preferredCurrency: string | null
  setPreferredCurrency: (currency: string) => void
  selectedCurrencies: Record<string, string>
  setPlanCurrency: (planRef: string, currency: string) => void
  getSelectedOption: (plan: Plan) => PlanPricingOption
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
  selectedOption: PlanPricingOption
  pricingOptions: PlanPricingOption[]
  state: CardState
  isCurrent: boolean
  isFree: boolean
  isPopular: boolean
  disabled: boolean
  select: () => void
  setCurrency: (currency: string) => void
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
    currentPlanRef === null ? null : (currentPlanRef ?? autoCurrentPlanRef)

  const isCurrent = useCallback(
    (ref: string) => resolvedCurrentPlanRef === ref,
    [resolvedCurrentPlanRef],
  )
  const isFree = useCallback(
    (ref: string) => plans.find(p => p.reference === ref)?.requiresPayment === false,
    [plans],
  )
  const isPopular = useCallback((ref: string) => popularPlanRef === ref, [popularPlanRef])

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
  const [preferredCurrency, setPreferredCurrencyState] = useState<string | null>(null)
  const [selectedCurrencies, setSelectedCurrencies] = useState<Record<string, string>>({})

  const getSelectedOption = useCallback(
    (plan: Plan) =>
      resolvePlanPricingOption(
        plan,
        selectedCurrencies[plan.reference] ?? preferredCurrency ?? null,
      ),
    [selectedCurrencies, preferredCurrency],
  )

  const setPreferredCurrency = useCallback((currency: string) => {
    setPreferredCurrencyState(currency.toUpperCase())
    setSelectedCurrencies({})
  }, [])

  const setPlanCurrency = useCallback((planRef: string, currency: string) => {
    setSelectedCurrencies(current => ({ ...current, [planRef]: currency }))
  }, [])

  const selectedCurrency = selectedPlan ? getSelectedOption(selectedPlan).currency : null

  // Auto-select the customer's already-active PAYG plan when it lands
  // in the visible plan list. The default checkout filter (see
  // `buildDefaultCheckoutPlanFilter`) collapses topup products down to
  // a single PAYG card, so without this the user faces a card stamped
  // "Current" with no way to advance — the only path forward is the
  // amount picker behind it. Recurring/one-time current plans stay
  // disabled (re-selecting would re-charge), so we gate on `isPaygPlan`.
  // One-shot per `productRef` so a manual `clearSelection` doesn't
  // immediately re-snap to the current plan.
  const autoCurrentAppliedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (autoCurrentAppliedKeyRef.current === productRef) return
    if (selectedPlanRef) {
      autoCurrentAppliedKeyRef.current = productRef
      return
    }
    if (!resolvedCurrentPlanRef || plans.length === 0) return
    const currentPlan = plans.find(p => p.reference === resolvedCurrentPlanRef)
    if (!currentPlan || !isPaygPlan(currentPlan)) {
      autoCurrentAppliedKeyRef.current = productRef
      return
    }
    autoCurrentAppliedKeyRef.current = productRef
    select(resolvedCurrentPlanRef)
  }, [productRef, plans, resolvedCurrentPlanRef, selectedPlanRef, select])

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
      preferredCurrency,
      setPreferredCurrency,
      selectedCurrencies,
      setPlanCurrency,
      getSelectedOption,
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
      preferredCurrency,
      setPreferredCurrency,
      selectedCurrencies,
      setPlanCurrency,
      getSelectedOption,
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
        selectedCurrency,
        setSelectedCurrency: currency => {
          if (currency) {
            setPreferredCurrency(currency)
          }
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
        // A "current" PAYG plan stays selectable so the customer can
        // step into the amount picker and top up. Re-selecting an
        // already-active recurring/one-time plan would re-charge them,
        // so those cards remain disabled. Free plans are always
        // disabled — they're informational, not a checkout target.
        const isPaygCurrent = isCurrent && isPaygPlan(plan)
        const disabled = isFree || (isCurrent && !isPaygCurrent)
        // Disabled current plans always read as 'current' regardless
        // of selection (consumers may auto-select them at the
        // `usePlans` layer; the visual should still communicate
        // "active, no action available"). Selectable PAYG-current
        // plans flip to 'selected' once the user clicks them so the
        // selection feedback isn't masked by the persistent badge.
        const state: CardState =
          isCurrent && !isPaygCurrent
            ? 'current'
            : selected
              ? 'selected'
              : isCurrent
                ? 'current'
                : isFree
                  ? 'disabled'
                  : 'idle'
        const pricingOptions = getPlanPricingOptions(plan)
        const selectedOption = ctx.getSelectedOption(plan)
        const cardCtx: CardContextValue = {
          plan,
          selectedOption,
          pricingOptions,
          state,
          isCurrent,
          isFree,
          isPopular,
          disabled,
          select: () => ctx.select(plan.reference),
          setCurrency: currency => ctx.setPlanCurrency(plan.reference, currency),
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
  // Plans configured without an explicit `name` would previously
  // collapse the card into a nameless price. Fall back to a
  // type-derived label so every card has a title.
  const fallback =
    card.plan.requiresPayment === false
      ? 'Free'
      : card.plan.type === 'usage-based'
        ? 'Pay as you go'
        : card.plan.type === 'recurring'
          ? 'Plan'
          : null
  const label = card.plan.name ?? fallback
  if (!label && children == null) return null
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-card-name="" {...rest}>
      {children ?? label}
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
    if (card.plan.type === 'usage-based') {
      return copy.planSelector.usageRateLabel
    }
    return formatPrice(card.selectedOption.price ?? 0, card.selectedOption.currency ?? 'usd', {
      locale,
      free: copy.interval.free,
    })
  }, [
    card.isFree,
    card.plan.type,
    card.selectedOption.price,
    card.selectedOption.currency,
    locale,
    copy.planSelector.freeBadge,
    copy.planSelector.usageRateLabel,
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
  // PAYG plans are usage-based, not per-cycle — the label lives on
  // `CardPrice` and a cycle suffix would be misleading here.
  if (card.isFree || card.plan.type === 'usage-based') return null
  // Bootstrap-shaped plans only populate `billingCycle`; legacy plans
  // fetched via the list-plans API populate `interval`. Support both
  // so the card renders a cycle suffix regardless of source.
  const rawInterval = card.plan.interval ?? normalizeBillingCycle(card.plan.billingCycle)
  if (!rawInterval) return null
  const text = interpolate(copy.planSelector.perIntervalShort, { interval: rawInterval })
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp ref={forwardedRef} data-solvapay-plan-selector-card-interval="" {...rest}>
      {children ?? text}
    </Comp>
  )
})

/**
 * Normalize a `billingCycle` string (e.g. `'monthly'`, `'yearly'`) to
 * the bare interval noun (`'month'`, `'year'`) so `perIntervalShort`
 * renders `/month` instead of `/monthly`. Matches the long-form
 * interval shape already used by plans fetched from `list-plans`.
 */
function normalizeBillingCycle(cycle: string | null | undefined): string | null {
  if (!cycle) return null
  const lc = cycle.toLowerCase()
  if (lc === 'monthly' || lc === 'month') return 'month'
  if (lc === 'yearly' || lc === 'annually' || lc === 'annual' || lc === 'year') return 'year'
  if (lc === 'weekly' || lc === 'week') return 'week'
  if (lc === 'daily' || lc === 'day') return 'day'
  return cycle
}

type BadgeProps = LeafProps & { 'data-variant'?: 'current' | 'popular' }

const CurrencySwitcher = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function PlanSelectorCurrencySwitcher({ children, onChange, className, ...rest }, forwardedRef) {
  const ctx = usePlanSelectorContext('CurrencySwitcher')

  const availableCurrencies = useMemo(() => {
    const currencies = new Set<string>()
    for (const plan of ctx.plans) {
      const options = getPlanPricingOptions(plan)
      if (options.length <= 1) continue
      for (const option of options) {
        currencies.add(option.currency.toUpperCase())
      }
    }
    return [...currencies].sort()
  }, [ctx.plans])

  if (availableCurrencies.length < 2) return null

  const effectiveCurrency =
    ctx.preferredCurrency ??
    (ctx.selectedPlan ? ctx.getSelectedOption(ctx.selectedPlan).currency.toUpperCase() : null) ??
    availableCurrencies[0]

  return (
    <select
      ref={forwardedRef}
      data-solvapay-plan-selector-currency-switcher=""
      className={className}
      value={effectiveCurrency}
      onChange={event => {
        ctx.setPreferredCurrency(event.target.value)
        onChange?.(event)
      }}
      {...rest}
    >
      {children ??
        availableCurrencies.map(currency => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
    </select>
  )
})

const CardCurrency = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function PlanSelectorCardCurrency({ children, onChange, ...rest }, forwardedRef) {
    const card = useCardContext('CardCurrency')
    if (card.pricingOptions.length <= 1) return null

    return (
      <select
        ref={forwardedRef}
        data-solvapay-plan-selector-card-currency=""
        value={card.selectedOption.currency}
        onChange={event => {
          card.setCurrency(event.target.value)
          onChange?.(event)
        }}
        {...rest}
      >
        {children ??
          card.pricingOptions.map(option => (
            <option key={option.currency} value={option.currency}>
              {option.currency}
            </option>
          ))}
      </select>
    )
  },
)

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
export const PlanSelectorCurrencySwitcher = CurrencySwitcher
export const PlanSelectorCardCurrency = CardCurrency
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
  CurrencySwitcher,
  CardCurrency,
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
