import { render, renderHook, act, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import {
  PlanSelectionContext,
  PlanSelectionProvider,
  usePlanSelection,
  type PlanSelectionContextValue,
} from './PlanSelectionContext'
import type { Plan } from '../types'

const monthlyPlan: Plan = {
  reference: 'pln_monthly',
  name: 'Monthly',
  price: 1999,
  currency: 'usd',
  type: 'recurring',
  interval: 'month',
}

const yearlyPlan: Plan = {
  reference: 'pln_yearly',
  name: 'Yearly',
  price: 19900,
  currency: 'usd',
  type: 'recurring',
  interval: 'year',
}

const baseValue: PlanSelectionContextValue = {
  productRef: 'prd_x',
  selectedPlanRef: null,
  setSelectedPlanRef: () => {},
  plans: [monthlyPlan, yearlyPlan],
  loading: false,
  error: null,
}

describe('PlanSelectionContext', () => {
  it('exports a React context with a null default', () => {
    expect(PlanSelectionContext).toBeDefined()
    const { result } = renderHook(() => usePlanSelection())
    expect(result.current).toBeNull()
  })

  it('usePlanSelection returns the provider value when inside a PlanSelectionProvider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlanSelectionProvider value={baseValue}>{children}</PlanSelectionProvider>
    )
    const { result } = renderHook(() => usePlanSelection(), { wrapper })
    expect(result.current).not.toBeNull()
    expect(result.current?.productRef).toBe('prd_x')
    expect(result.current?.plans).toHaveLength(2)
    expect(result.current?.selectedPlanRef).toBeNull()
    expect(result.current?.loading).toBe(false)
    expect(result.current?.error).toBeNull()
  })

  it('propagates selection changes to consumers via setSelectedPlanRef', () => {
    function Harness() {
      const [selectedPlanRef, setSelectedPlanRef] = React.useState<string | null>(null)
      const value: PlanSelectionContextValue = {
        ...baseValue,
        selectedPlanRef,
        setSelectedPlanRef,
      }
      return (
        <PlanSelectionProvider value={value}>
          <Consumer />
        </PlanSelectionProvider>
      )
    }
    function Consumer() {
      const ctx = usePlanSelection()
      if (!ctx) return null
      return (
        <div>
          <span data-testid="selected">{ctx.selectedPlanRef ?? 'none'}</span>
          <button onClick={() => ctx.setSelectedPlanRef('pln_yearly')}>select yearly</button>
        </div>
      )
    }

    render(<Harness />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
    act(() => {
      screen.getByText('select yearly').click()
    })
    expect(screen.getByTestId('selected').textContent).toBe('pln_yearly')
  })

  it('passes loading and error through unchanged', () => {
    const loadingValue: PlanSelectionContextValue = {
      ...baseValue,
      plans: [],
      loading: true,
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PlanSelectionProvider value={loadingValue}>{children}</PlanSelectionProvider>
    )
    const { result } = renderHook(() => usePlanSelection(), { wrapper })
    expect(result.current?.loading).toBe(true)
    expect(result.current?.plans).toHaveLength(0)

    const err = new Error('boom')
    const errorValue: PlanSelectionContextValue = {
      ...baseValue,
      error: err,
    }
    const wrapper2 = ({ children }: { children: React.ReactNode }) => (
      <PlanSelectionProvider value={errorValue}>{children}</PlanSelectionProvider>
    )
    const { result: result2 } = renderHook(() => usePlanSelection(), { wrapper: wrapper2 })
    expect(result2.current?.error).toBe(err)
  })

  it('nested providers resolve to the nearest value', () => {
    const outer: PlanSelectionContextValue = { ...baseValue, productRef: 'prd_outer' }
    const inner: PlanSelectionContextValue = { ...baseValue, productRef: 'prd_inner' }

    function Leaf() {
      const ctx = usePlanSelection()
      return <span data-testid="leaf">{ctx?.productRef}</span>
    }

    render(
      <PlanSelectionProvider value={outer}>
        <PlanSelectionProvider value={inner}>
          <Leaf />
        </PlanSelectionProvider>
      </PlanSelectionProvider>,
    )
    expect(screen.getByTestId('leaf').textContent).toBe('prd_inner')
  })
})
