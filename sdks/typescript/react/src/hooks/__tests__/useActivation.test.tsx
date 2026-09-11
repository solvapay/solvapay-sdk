import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useActivation } from '../useActivation'
import { useSolvaPay } from '../useSolvaPay'

vi.mock('../useSolvaPay', () => ({
  useSolvaPay: vi.fn(),
}))

const mockedUseSolvaPay = vi.mocked(useSolvaPay)

function mockActivate(status: string, extra: Record<string, unknown> = {}) {
  const activatePlan = vi.fn().mockResolvedValue({ status, ...extra })
  mockedUseSolvaPay.mockReturnValue({ activatePlan } as never)
  return activatePlan
}

describe('useActivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps already_purchased to activated', async () => {
    mockActivate('already_purchased')
    const { result } = renderHook(() => useActivation())
    let next = 'idle'
    await act(async () => {
      next = await result.current.activate({ productRef: 'prd_test', planRef: 'pln_pro' })
    })
    expect(next).toBe('activated')
    expect(result.current.state).toBe('activated')
    expect(result.current.error).toBeNull()
  })

  it('maps already_active to activated', async () => {
    mockActivate('already_active')
    const { result } = renderHook(() => useActivation())
    let next = 'idle'
    await act(async () => {
      next = await result.current.activate({ productRef: 'prd_test', planRef: 'pln_pro' })
    })
    expect(next).toBe('activated')
    expect(result.current.state).toBe('activated')
  })
})
