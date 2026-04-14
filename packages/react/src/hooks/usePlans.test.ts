import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePlans, plansCache } from './usePlans'
import type { Plan } from '../types'

const freePlan: Plan = { reference: 'plan_free', name: 'Free', price: 0, requiresPayment: false }
const basicPlan: Plan = { reference: 'plan_basic', name: 'Basic', price: 1000, requiresPayment: true }
const proPlan: Plan = { reference: 'plan_pro', name: 'Pro', price: 2000, requiresPayment: true }

const allPlans = [freePlan, basicPlan, proPlan]

function createFetcher(plans: Plan[] = allPlans) {
  return vi.fn().mockResolvedValue(plans)
}

function createDelayedFetcher(plans: Plan[] = allPlans, ms = 50) {
  return vi.fn().mockImplementation(
    () => new Promise<Plan[]>(resolve => setTimeout(() => resolve(plans), ms)),
  )
}

beforeEach(() => {
  plansCache.clear()
})

describe('usePlans', () => {
  describe('basic fetching', () => {
    it('fetches and returns plans', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({ productRef: 'prd_1', fetcher }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.plans).toEqual(allPlans)
      expect(result.current.error).toBeNull()
    })

    it('sets error when productRef is missing', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({ productRef: '', fetcher }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toBeInstanceOf(Error)
    })

    it('sets error when fetcher throws', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('Network error'))
      const { result } = renderHook(() =>
        usePlans({ productRef: 'prd_1', fetcher }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error?.message).toBe('Network error')
    })
  })

  describe('initial selection with selectionReady=true (default)', () => {
    it('selects plan matching initialPlanRef', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          initialPlanRef: 'plan_pro',
          selectionReady: true,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(2)
      expect(result.current.selectedPlan?.reference).toBe('plan_pro')
      expect(result.current.isSelectionReady).toBe(true)
    })

    it('falls back to autoSelectFirstPaid when initialPlanRef is undefined', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          autoSelectFirstPaid: true,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(1)
      expect(result.current.selectedPlan?.reference).toBe('plan_basic')
    })

    it('falls back to autoSelectFirstPaid when initialPlanRef does not match', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          initialPlanRef: 'plan_nonexistent',
          autoSelectFirstPaid: true,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(1)
      expect(result.current.selectedPlan?.reference).toBe('plan_basic')
    })

    it('defaults to index 0 when no initialPlanRef and autoSelectFirstPaid is false', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({ productRef: 'prd_1', fetcher }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(0)
    })
  })

  describe('deferred selection (selectionReady=false)', () => {
    it('does not apply selection while selectionReady is false', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          initialPlanRef: 'plan_pro',
          selectionReady: false,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(0)
      expect(result.current.isSelectionReady).toBe(false)
    })

    it('applies selection when selectionReady transitions to true', async () => {
      const fetcher = createFetcher()
      const { result, rerender } = renderHook(
        ({ selectionReady }) =>
          usePlans({
            productRef: 'prd_1',
            fetcher,
            initialPlanRef: 'plan_pro',
            selectionReady,
          }),
        { initialProps: { selectionReady: false } },
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(0)

      rerender({ selectionReady: true })

      await waitFor(() => expect(result.current.isSelectionReady).toBe(true))
      expect(result.current.selectedPlanIndex).toBe(2)
      expect(result.current.selectedPlan?.reference).toBe('plan_pro')
    })

    it('applies selection when plans arrive after selectionReady is true', async () => {
      const fetcher = createDelayedFetcher(allPlans, 100)
      const { result, rerender } = renderHook(
        ({ selectionReady }) =>
          usePlans({
            productRef: 'prd_1',
            fetcher,
            initialPlanRef: 'plan_basic',
            selectionReady,
          }),
        { initialProps: { selectionReady: false } },
      )

      // selectionReady becomes true before fetch completes
      rerender({ selectionReady: true })

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(1)
      expect(result.current.selectedPlan?.reference).toBe('plan_basic')
      expect(result.current.isSelectionReady).toBe(true)
    })
  })

  describe('one-shot selection (never overrides)', () => {
    it('ignores initialPlanRef changes after initial selection', async () => {
      const fetcher = createFetcher()
      const { result, rerender } = renderHook(
        ({ initialPlanRef }) =>
          usePlans({
            productRef: 'prd_1',
            fetcher,
            initialPlanRef,
            selectionReady: true,
          }),
        { initialProps: { initialPlanRef: 'plan_basic' } },
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(1)

      rerender({ initialPlanRef: 'plan_pro' })

      // Selection should NOT change
      expect(result.current.selectedPlanIndex).toBe(1)
      expect(result.current.selectedPlan?.reference).toBe('plan_basic')
    })

    it('preserves user selection after setSelectedPlanIndex', async () => {
      const fetcher = createFetcher()
      const { result, rerender } = renderHook(
        ({ initialPlanRef }) =>
          usePlans({
            productRef: 'prd_1',
            fetcher,
            initialPlanRef,
            selectionReady: true,
          }),
        { initialProps: { initialPlanRef: 'plan_basic' } },
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(1)

      act(() => result.current.setSelectedPlanIndex(2))
      expect(result.current.selectedPlanIndex).toBe(2)

      // Changing initialPlanRef should NOT override user selection
      rerender({ initialPlanRef: 'plan_free' })
      expect(result.current.selectedPlanIndex).toBe(2)
    })

    it('preserves user selection after selectPlan', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          initialPlanRef: 'plan_free',
          selectionReady: true,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(0)

      act(() => result.current.selectPlan('plan_pro'))
      expect(result.current.selectedPlanIndex).toBe(2)
      expect(result.current.selectedPlan?.reference).toBe('plan_pro')
    })
  })

  describe('user selection blocks deferred auto-selection', () => {
    it('does not override user pick when selectionReady transitions to true', async () => {
      const fetcher = createFetcher()
      const { result, rerender } = renderHook(
        ({ selectionReady }) =>
          usePlans({
            productRef: 'prd_1',
            fetcher,
            initialPlanRef: 'plan_pro',
            selectionReady,
          }),
        { initialProps: { selectionReady: false } },
      )

      await waitFor(() => expect(result.current.loading).toBe(false))

      // User picks a plan while purchase is still loading
      act(() => result.current.setSelectedPlanIndex(0))
      expect(result.current.selectedPlanIndex).toBe(0)

      // Purchase finishes loading
      rerender({ selectionReady: true })

      // User selection must be preserved
      expect(result.current.selectedPlanIndex).toBe(0)
      expect(result.current.selectedPlan?.reference).toBe('plan_free')
    })
  })

  describe('cache behavior', () => {
    it('uses cached plans on remount with correct initial index', async () => {
      const fetcher = createFetcher()

      // First mount populates the cache
      const { result: r1, unmount } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          selectionReady: true,
        }),
      )
      await waitFor(() => expect(r1.current.loading).toBe(false))
      unmount()

      // Second mount should use cache — selection computed synchronously
      const { result: r2 } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          initialPlanRef: 'plan_pro',
          selectionReady: true,
        }),
      )

      // Should have correct index from the cache init (no flash)
      expect(r2.current.selectedPlanIndex).toBe(2)
      expect(r2.current.isSelectionReady).toBe(true)
    })

    it('preserves selection across refetch', async () => {
      const fetcher = createFetcher()
      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          initialPlanRef: 'plan_basic',
          selectionReady: true,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.selectedPlanIndex).toBe(1)

      act(() => result.current.setSelectedPlanIndex(2))
      expect(result.current.selectedPlanIndex).toBe(2)

      // Refetch should not change user selection
      await act(async () => {
        await result.current.refetch()
      })

      expect(result.current.selectedPlanIndex).toBe(2)
    })
  })

  describe('filter and sortBy', () => {
    it('applies sortBy before filter', async () => {
      const fetcher = createFetcher([proPlan, freePlan, basicPlan])
      const sortByPrice = (a: Plan, b: Plan) => (a.price || 0) - (b.price || 0)
      const firstTwo = (_p: Plan, i: number) => i < 2

      const { result } = renderHook(() =>
        usePlans({
          productRef: 'prd_1',
          fetcher,
          sortBy: sortByPrice,
          filter: firstTwo,
          selectionReady: true,
        }),
      )

      await waitFor(() => expect(result.current.loading).toBe(false))
      // Sorted: free(0), basic(1000), pro(2000) -> first two: free, basic
      expect(result.current.plans).toEqual([freePlan, basicPlan])
    })
  })
})
