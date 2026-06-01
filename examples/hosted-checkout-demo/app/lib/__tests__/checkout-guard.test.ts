import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { acquireCheckoutLock, releaseCheckoutLock, useCheckoutInProgress } from '../checkout-guard'

beforeEach(() => {
  // Reset module-level lock state. releaseCheckoutLock() is idempotent when already free.
  releaseCheckoutLock()
})

describe('acquireCheckoutLock', () => {
  it('returns true when lock is free', () => {
    expect(acquireCheckoutLock()).toBe(true)
  })

  it('returns false while lock is held', () => {
    acquireCheckoutLock()
    expect(acquireCheckoutLock()).toBe(false)
  })

  it('returns true again after release', () => {
    acquireCheckoutLock()
    releaseCheckoutLock()
    expect(acquireCheckoutLock()).toBe(true)
  })
})

describe('concurrent acquire simulation', () => {
  it('exactly one of two concurrent callers wins the lock', () => {
    // Simulates Navigation and page.tsx both calling handleUpgrade in the same tick
    const results = [acquireCheckoutLock(), acquireCheckoutLock()]
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.filter(r => !r)).toHaveLength(1)
  })
})

describe('useCheckoutInProgress', () => {
  it('is false when lock is free', () => {
    const { result } = renderHook(() => useCheckoutInProgress())
    expect(result.current).toBe(false)
  })

  it('becomes true after lock is acquired', () => {
    const { result } = renderHook(() => useCheckoutInProgress())
    act(() => { acquireCheckoutLock() })
    expect(result.current).toBe(true)
  })

  it('returns to false after lock is released', () => {
    const { result } = renderHook(() => useCheckoutInProgress())
    act(() => { acquireCheckoutLock() })
    act(() => { releaseCheckoutLock() })
    expect(result.current).toBe(false)
  })

  it('two independent hook instances reflect the same lock state', () => {
    // Regression: original bug used isolated useState per component.
    // Both hooks must read from the shared module-level flag, not local state.
    const { result: r1 } = renderHook(() => useCheckoutInProgress())
    const { result: r2 } = renderHook(() => useCheckoutInProgress())

    act(() => { acquireCheckoutLock() })

    expect(r1.current).toBe(true)
    expect(r2.current).toBe(true)
  })
})
