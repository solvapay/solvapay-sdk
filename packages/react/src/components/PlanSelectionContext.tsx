'use client'
import React, { createContext, useContext } from 'react'
import type { Plan } from '../types'

/**
 * Shared plan-selection state, consumed by SDK components that need to know
 * which plan the user is currently working with without explicit prop-drilling.
 *
 * `<CheckoutSummary>`, `<MandateText>`, and `<PaymentForm>` fall back to this
 * context when their own `planRef` prop is omitted, so nested composition
 * works seamlessly inside `<PlanSelector>` or `<CheckoutLayout>`.
 *
 * @internal Intentionally not exported from the package root. SDK primitives
 * own the provider; end integrators compose through `<PlanSelector>` or
 * `<CheckoutLayout>` instead of wiring this context directly.
 */
export interface PlanSelectionContextValue {
  productRef: string | undefined
  selectedPlanRef: string | null
  setSelectedPlanRef: (planRef: string | null) => void
  plans: Plan[]
  loading: boolean
  error: Error | null
}

/** @internal */
export const PlanSelectionContext = createContext<PlanSelectionContextValue | null>(null)

/** @internal */
export interface PlanSelectionProviderProps {
  value: PlanSelectionContextValue
  children: React.ReactNode
}

/** @internal */
export const PlanSelectionProvider: React.FC<PlanSelectionProviderProps> = ({
  value,
  children,
}) => (
  <PlanSelectionContext.Provider value={value}>{children}</PlanSelectionContext.Provider>
)

/**
 * Reads the current plan-selection context. Returns `null` when called outside
 * a `<PlanSelectionProvider>` so consumers can gracefully fall back to their
 * own `planRef` prop.
 *
 * @internal
 */
export function usePlanSelection(): PlanSelectionContextValue | null {
  return useContext(PlanSelectionContext)
}
