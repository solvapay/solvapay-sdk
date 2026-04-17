'use client'

/**
 * Default-tree shim over the `PlanSelector` primitive.
 *
 * Consumers who want a drop-in grid of plan cards use this component.
 * Consumers who want full control compose `@solvapay/react/primitives`
 * directly.
 *
 * The legacy `children={args => ...}` render-prop path is kept as an internal
 * escape hatch used only by `CheckoutLayout` and is scheduled for removal in
 * PR 3 when `CheckoutLayout` is recomposed on top of the primitive tree.
 */

import React from 'react'
import {
  PlanSelector as Primitive,
  usePlanSelector,
} from '../primitives/PlanSelector'
import type { Plan, UsePlansReturn } from '../types'

/**
 * @internal Not exported from `@solvapay/react`. Only `CheckoutLayout`'s
 * `RenderedSelector` relies on this render-prop shape and both go away in
 * PR 3.
 */
export interface PlanSelectorRenderArgs extends UsePlansReturn {
  isCurrentPlan: (planRef: string) => boolean
  isFreePlan: (planRef: string) => boolean
  select: (planRef: string) => void
  selectedPlanRef: string | null
}

export interface PlanSelectorProps {
  productRef: string
  fetcher?: (productRef: string) => Promise<Plan[]>
  filter?: (plan: Plan, index: number) => boolean
  sortBy?: (a: Plan, b: Plan) => number
  autoSelectFirstPaid?: boolean
  initialPlanRef?: string
  currentPlanRef?: string | null
  popularPlanRef?: string
  onSelect?: (planRef: string, plan: Plan) => void
  className?: string
  children?: React.ReactNode | ((args: PlanSelectorRenderArgs) => React.ReactNode)
}

const DefaultTree: React.FC = () => (
  <>
    <Primitive.Heading className="solvapay-plan-selector-heading" />
    <Primitive.Grid className="solvapay-plan-selector-grid">
      <Primitive.Card className="solvapay-plan-selector-card">
        <Primitive.CardBadge className="solvapay-plan-selector-card-badge" />
        <Primitive.CardName className="solvapay-plan-selector-card-name" />
        <Primitive.CardPrice className="solvapay-plan-selector-card-price" />
        <Primitive.CardInterval className="solvapay-plan-selector-card-interval" />
      </Primitive.Card>
    </Primitive.Grid>
    <Primitive.Loading className="solvapay-plan-selector-loading" />
    <Primitive.Error className="solvapay-plan-selector-error" />
  </>
)

/** @internal — PR 3 deletes the function-child escape hatch alongside
 * `CheckoutLayout`'s `RenderedSelector`. */
const LegacyFunctionChild: React.FC<{
  render: (args: PlanSelectorRenderArgs) => React.ReactNode
}> = ({ render }) => {
  const ctx = usePlanSelector()
  const index = ctx.selectedPlan ? ctx.plans.indexOf(ctx.selectedPlan) : 0
  const args: PlanSelectorRenderArgs = {
    plans: ctx.plans,
    loading: ctx.loading,
    error: ctx.error,
    selectedPlan: ctx.selectedPlan,
    selectedPlanIndex: index,
    setSelectedPlanIndex: idx => {
      const p = ctx.plans[idx]
      if (p) ctx.select(p.reference)
    },
    selectPlan: ctx.select,
    refetch: () => Promise.resolve(),
    isSelectionReady: !ctx.loading,
    isCurrentPlan: ctx.isCurrent,
    isFreePlan: ctx.isFree,
    select: ctx.select,
    selectedPlanRef: ctx.selectedPlanRef,
  }
  return <>{render(args)}</>
}

export const PlanSelector: React.FC<PlanSelectorProps> = props => {
  const { children, className, ...rootProps } = props

  const rootClass = ['solvapay-plan-selector', className].filter(Boolean).join(' ')

  if (typeof children === 'function') {
    return (
      <Primitive.Root {...rootProps} className={rootClass}>
        <LegacyFunctionChild render={children} />
      </Primitive.Root>
    )
  }

  if (children !== undefined) {
    return (
      <Primitive.Root {...rootProps} className={rootClass}>
        {children}
      </Primitive.Root>
    )
  }

  return (
    <Primitive.Root {...rootProps} className={rootClass}>
      <DefaultTree />
    </Primitive.Root>
  )
}
