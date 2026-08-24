import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BALANCE_RECONCILE_DELAYS_MS,
  pollBalanceUntilIncreased,
} from './balance-poll'

describe('pollBalanceUntilIncreased', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns creditsAdded when balance increases on a later poll', async () => {
    const getBalance = vi
      .fn()
      .mockResolvedValueOnce({ credits: 400 })
      .mockResolvedValueOnce({ credits: 10_000 })

    const promise = pollBalanceUntilIncreased(getBalance, 400, [500, 1000])

    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(getBalance).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ creditsAdded: 9600 })
  })

  it('returns null when the poll budget exhausts without an increase', async () => {
    const getBalance = vi.fn().mockResolvedValue({ credits: 400 })

    const promise = pollBalanceUntilIncreased(getBalance, 400, [500, 1000])

    await vi.advanceTimersByTimeAsync(1500)
    const result = await promise

    expect(getBalance).toHaveBeenCalledTimes(2)
    expect(result).toBeNull()
  })

  it('exports a longer default delay schedule for async auto-recharge reconciliation', () => {
    expect(BALANCE_RECONCILE_DELAYS_MS.length).toBeGreaterThan(4)
    expect(BALANCE_RECONCILE_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)).toBeGreaterThan(
      7500,
    )
  })
})
