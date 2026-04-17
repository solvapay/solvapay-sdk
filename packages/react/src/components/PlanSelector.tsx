'use client'
import React, { createContext, useCallback, useContext, useMemo } from 'react'
import { usePlans } from '../hooks/usePlans'
import { usePurchase } from '../hooks/usePurchase'
import { useSolvaPay } from '../hooks/useSolvaPay'
import { useCopy, useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'
import { interpolate } from '../i18n/interpolate'
import { PlanSelectionProvider } from './PlanSelectionContext'
import { buildRequestHeaders } from '../utils/headers'
import type { Plan, UsePlansReturn, SolvaPayConfig } from '../types'

/**
 * ClassName overrides for every default visual region. All optional — omit
 * fields you're happy with. Pass `unstyled` to drop inline defaults.
 */
export interface PlanSelectorClassNames {
  root?: string
  heading?: string
  grid?: string
  card?: string
  cardSelected?: string
  cardDisabled?: string
  cardCurrent?: string
  name?: string
  price?: string
  interval?: string
  trialBadge?: string
  currentBadge?: string
  popularBadge?: string
  freeBadge?: string
}

export interface PlanSelectorRenderArgs extends UsePlansReturn {
  isCurrentPlan: (planRef: string) => boolean
  isFreePlan: (planRef: string) => boolean
  select: (planRef: string) => void
  selectedPlanRef: string | null
}

export interface PlanSelectorProps {
  productRef: string
  /** Override the default listPlans fetcher (defaults to /api/list-plans). */
  fetcher?: (productRef: string) => Promise<Plan[]>
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  autoSelectFirstPaid?: boolean
  initialPlanRef?: string
  /**
   * Mark a specific plan as "current" to show the badge and disable
   * re-selection. When omitted, auto-detected from `usePurchase()`'s active
   * purchase. Pass `null` to suppress automatic detection (anonymous
   * checkout, for instance).
   */
  currentPlanRef?: string | null
  /** Plan to flag with the "Popular" badge. Omit for no badge. */
  popularPlanRef?: string
  onSelect?: (planRef: string, plan: Plan) => void
  classNames?: PlanSelectorClassNames
  unstyled?: boolean
  /** Optional className applied to the root container. */
  className?: string
  children?: React.ReactNode | ((args: PlanSelectorRenderArgs) => React.ReactNode)
}

async function defaultListPlans(
  productRef: string,
  config: SolvaPayConfig | undefined,
): Promise<Plan[]> {
  const base = config?.api?.listPlans || '/api/list-plans'
  const url = `${base}?productRef=${encodeURIComponent(productRef)}`
  const fetchFn = config?.fetch || fetch
  const { headers } = await buildRequestHeaders(config)
  const res = await fetchFn(url, { method: 'GET', headers })
  if (!res.ok) {
    const error = new Error(`Failed to fetch plans: ${res.statusText || res.status}`)
    config?.onError?.(error, 'listPlans')
    throw error
  }
  const data = (await res.json()) as { plans?: Plan[] }
  return data.plans ?? []
}

type PlanRowContext = {
  plan: Plan
  index: number
  selected: boolean
  isCurrent: boolean
  isFree: boolean
  isPopular: boolean
  select: () => void
  classNames: PlanSelectorClassNames
  unstyled: boolean
  locale: string | undefined
}

const PlanRowCtx = createContext<PlanRowContext | null>(null)

function usePlanRow(): PlanRowContext {
  const ctx = useContext(PlanRowCtx)
  if (!ctx) {
    throw new Error(
      'PlanSelector.Card must be rendered inside <PlanSelector> (it needs the per-plan context from usePlans).',
    )
  }
  return ctx
}

const defaultRootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const defaultGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
}

const defaultHeadingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'rgba(0,0,0,0.75)',
  letterSpacing: 0.2,
  textTransform: 'uppercase',
  margin: 0,
}

function baseCardStyle(
  selected: boolean,
  disabled: boolean,
  unstyled: boolean,
): React.CSSProperties {
  if (unstyled) return {}
  return {
    position: 'relative',
    padding: '20px 16px',
    border: `2px solid ${selected ? '#16a34a' : 'rgba(0,0,0,0.12)'}`,
    borderRadius: 12,
    background: disabled ? 'rgba(0,0,0,0.03)' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    textAlign: 'left',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
    boxShadow: selected ? '0 0 0 3px rgba(22,163,74,0.12)' : 'none',
  }
}

/**
 * Heading slot. When `children` is omitted, renders the copy bundle heading.
 */
const Heading: React.FC<{
  className?: string
  children?: React.ReactNode
}> = ({ className, children }) => {
  const copy = useCopy()
  return (
    <h3
      className={className}
      data-solvapay-plan-selector-heading=""
      style={className ? undefined : defaultHeadingStyle}
    >
      {children ?? copy.planSelector.heading}
    </h3>
  )
}

/**
 * Single plan card. Reads its plan state from the per-row context injected
 * by the parent `<PlanSelector>`. Overriding this slot replaces the default
 * card layout — integrators get full control over markup.
 */
const Card: React.FC<{
  className?: string
  children?: React.ReactNode | ((row: PlanRowContext) => React.ReactNode)
}> = ({ className, children }) => {
  const row = usePlanRow()
  const copy = useCopy()
  const { plan, selected, isCurrent, isFree, isPopular, select, classNames, unstyled, locale } =
    row

  if (typeof children === 'function') {
    return (
      <button
        type="button"
        onClick={select}
        disabled={isFree || isCurrent}
        data-solvapay-plan-card=""
        data-selected={selected || undefined}
        data-current={isCurrent || undefined}
        data-free={isFree || undefined}
        className={className ?? classNames.card}
        style={baseCardStyle(selected, isFree || isCurrent, unstyled)}
      >
        {children(row)}
      </button>
    )
  }

  const priceFormatted = formatPrice(plan.price ?? 0, plan.currency ?? 'usd', {
    locale,
    free: copy.interval.free,
  })
  const interval = plan.interval
    ? interpolate(copy.planSelector.perIntervalShort, { interval: plan.interval })
    : ''

  return (
    <button
      type="button"
      onClick={select}
      disabled={isFree || isCurrent}
      data-solvapay-plan-card=""
      data-selected={selected || undefined}
      data-current={isCurrent || undefined}
      data-free={isFree || undefined}
      className={className ?? classNames.card}
      style={baseCardStyle(selected, isFree || isCurrent, unstyled)}
    >
      {isCurrent && (
        <span
          data-solvapay-plan-badge="current"
          className={classNames.currentBadge}
          style={
            unstyled
              ? undefined
              : {
                  position: 'absolute',
                  top: -10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#0f172a',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '2px 10px',
                  borderRadius: 999,
                }
          }
        >
          {copy.planSelector.currentBadge}
        </span>
      )}
      {!isCurrent && isPopular && !isFree && (
        <span
          data-solvapay-plan-badge="popular"
          className={classNames.popularBadge}
          style={
            unstyled
              ? undefined
              : {
                  position: 'absolute',
                  top: -10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#3b82f6',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '2px 10px',
                  borderRadius: 999,
                }
          }
        >
          {copy.planSelector.popularBadge}
        </span>
      )}
      {plan.name && (
        <div
          className={classNames.name}
          style={unstyled ? undefined : { fontSize: 13, color: 'rgba(0,0,0,0.6)', marginBottom: 4 }}
        >
          {plan.name}
        </div>
      )}
      <div
        className={classNames.price}
        style={unstyled ? undefined : { fontSize: 22, fontWeight: 700, color: '#0f172a' }}
      >
        {isFree ? copy.planSelector.freeBadge : priceFormatted}
      </div>
      {!isFree && interval && (
        <div
          className={classNames.interval}
          style={unstyled ? undefined : { fontSize: 12, color: 'rgba(0,0,0,0.55)' }}
        >
          {interval}
        </div>
      )}
      {plan.trialDays && plan.trialDays > 0 && (
        <div
          className={classNames.trialBadge}
          style={unstyled ? undefined : { marginTop: 6, fontSize: 11, color: '#16a34a' }}
        >
          {interpolate(copy.planSelector.trialBadge, { trialDays: plan.trialDays })}
        </div>
      )}
    </button>
  )
}

type PlanSelectorComponent = React.FC<PlanSelectorProps> & {
  Heading: typeof Heading
  Card: typeof Card
}

/**
 * Styled-default plan selector. Renders a card grid of the product's active
 * plans, with the current plan badged and re-selection disabled, free plans
 * visually dimmed, and selection state exposed via `PlanSelectionContext` so
 * nested `<CheckoutSummary>`, `<MandateText>`, and `<PaymentForm>` pick up
 * the selected plan automatically.
 *
 * Three composition modes:
 *
 * 1. **No children** — styled default tree (heading + card grid).
 * 2. **Slot children** — `<PlanSelector.Heading>` / `<PlanSelector.Card>` to
 *    override individual regions while keeping the grid + state machine.
 * 3. **Function child** — render-prop escape hatch for fully custom markup.
 */
export const PlanSelector: PlanSelectorComponent = Object.assign(
  ((props: PlanSelectorProps) => {
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
      classNames = {},
      unstyled = false,
      className,
      children,
    } = props

    const copy = useCopy()
    const locale = useLocale()
    const { _config } = useSolvaPay()
    const { purchases } = usePurchase()

    const effectiveFetcher = useMemo(
      () => fetcher ?? ((ref: string) => defaultListPlans(ref, _config)),
      [fetcher, _config],
    )

    const plansHook = usePlans({
      productRef,
      fetcher: effectiveFetcher,
      filter,
      sortBy,
      autoSelectFirstPaid,
      initialPlanRef,
    })

    const { plans, selectedPlan, selectPlan, loading, error } = plansHook

    const autoCurrentPlanRef = useMemo(() => {
      const activePurchases = purchases.filter(p => p.status === 'active')
      const active =
        activePurchases.sort(
          (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
        )[0] || null
      return active?.planSnapshot?.reference ?? null
    }, [purchases])

    const resolvedCurrentPlanRef =
      currentPlanRef === null ? null : currentPlanRef ?? autoCurrentPlanRef

    const isCurrentPlan = useCallback(
      (ref: string) => resolvedCurrentPlanRef === ref,
      [resolvedCurrentPlanRef],
    )
    const isFreePlan = useCallback(
      (ref: string) => plans.find(p => p.reference === ref)?.requiresPayment === false,
      [plans],
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

    const selectedPlanRef = selectedPlan?.reference ?? null

    // Function-child render prop
    if (typeof children === 'function') {
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
          {children({
            ...plansHook,
            isCurrentPlan,
            isFreePlan,
            select,
            selectedPlanRef,
          })}
        </PlanSelectionProvider>
      )
    }

    // Slot composition or default tree
    const slotChildren = children
    const rows = plans.map((plan, index) => {
      const row: PlanRowContext = {
        plan,
        index,
        selected: selectedPlanRef === plan.reference,
        isCurrent: isCurrentPlan(plan.reference),
        isFree: plan.requiresPayment === false,
        isPopular: popularPlanRef === plan.reference,
        select: () => select(plan.reference),
        classNames,
        unstyled,
        locale,
      }
      return { row, plan }
    })

    const body = slotChildren ? (
      <>
        {rows.map(({ row, plan }) => (
          <PlanRowCtx.Provider key={plan.reference} value={row}>
            {slotChildren}
          </PlanRowCtx.Provider>
        ))}
      </>
    ) : (
      <>
        <Heading className={classNames.heading} />
        <div
          className={classNames.grid}
          data-solvapay-plan-grid=""
          style={unstyled ? undefined : defaultGridStyle}
        >
          {rows.map(({ row, plan }) => (
            <PlanRowCtx.Provider key={plan.reference} value={row}>
              <Card />
            </PlanRowCtx.Provider>
          ))}
        </div>
      </>
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
        <div
          data-solvapay-plan-selector=""
          className={className ?? classNames.root}
          style={unstyled || className || classNames.root ? undefined : defaultRootStyle}
        >
          {body}
        </div>
      </PlanSelectionProvider>
    )
  }) as React.FC<PlanSelectorProps>,
  { Heading, Card },
)
