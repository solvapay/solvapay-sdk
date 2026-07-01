import { describe, it, expect, vi } from 'vitest'
import type { AutoRechargeConfig } from '@solvapay/server'
import { waitForAutoRechargeActivation } from './autoRechargeActivation'

type AutoRechargeStatus = AutoRechargeConfig['status']

const noopSleep = () => Promise.resolve()

describe('waitForAutoRechargeActivation', () => {
  it('returns true immediately when the status is already active', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn(noopSleep)

    const result = await waitForAutoRechargeActivation({
      refresh,
      getStatus: () => 'active',
      attempts: 5,
      delayMs: 800,
      sleep,
    })

    expect(result).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(true)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('returns false after exhausting attempts when the server never confirms', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn(noopSleep)

    const result = await waitForAutoRechargeActivation({
      refresh,
      getStatus: () => 'pending_setup',
      attempts: 4,
      delayMs: 800,
      sleep,
    })

    expect(result).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('returns true when the status flips to active on a later poll', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn(noopSleep)
    const statuses: AutoRechargeStatus[] = ['pending_setup', 'pending_setup', 'active']
    let call = 0
    const getStatus = () => statuses[Math.min(call++, statuses.length - 1)]

    const result = await waitForAutoRechargeActivation({
      refresh,
      getStatus,
      attempts: 5,
      delayMs: 800,
      sleep,
    })

    expect(result).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
