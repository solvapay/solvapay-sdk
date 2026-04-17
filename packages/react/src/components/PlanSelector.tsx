'use client'

/**
 * Default-tree shim over the `PlanSelector` primitive.
 *
 * Consumers who want a drop-in grid of plan cards use this component.
 * Consumers who want full control compose `@solvapay/react/primitives`
 * directly.
 */

import React from 'react'
import { PlanSelector as Primitive } from '../primitives/PlanSelector'
import type { Plan } from '../types'

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
  children?: React.ReactNode
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

export const PlanSelector: React.FC<PlanSelectorProps> = props => {
  const { children, className, ...rootProps } = props
  const rootClass = ['solvapay-plan-selector', className].filter(Boolean).join(' ')

  return (
    <Primitive.Root {...rootProps} className={rootClass}>
      {children ?? <DefaultTree />}
    </Primitive.Root>
  )
}
