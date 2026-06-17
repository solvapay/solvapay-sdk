import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayProvider } from '../../SolvaPayProvider'
import { autoRechargeCache, useAutoRecharge } from '../useAutoRecharge'
import type { AutoRechargeConfig } from '@solvapay/server'

const config: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdCredits: 500 },
  topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
  rechargeCount: 0,
  fundingSourceType: 'saved_card',
  paymentMethodId: 'pm_123',
  status: 'active',
  failureCount: 0,
}

function makeFetch(payloads: unknown[]) {
  return vi.fn().mockImplementation(async () => {
    const payload = payloads.shift()
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function wrapper(configOverride: Parameters<typeof SolvaPayProvider>[0]['config']) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <SolvaPayProvider config={configOverride}>{children}</SolvaPayProvider>
  )
  Wrapper.displayName = 'AutoRechargeHookWrapper'
  return Wrapper
}

beforeEach(() => {
  autoRechargeCache.clear()
})

describe('useAutoRecharge', () => {
  it('loads auto-recharge config from the default route', async () => {
    const fetchFn = makeFetch([{ config }])
    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.config).toMatchObject({
      enabled: true,
      trigger: { type: 'balance', thresholdCredits: 500 },
    })
    expect(fetchFn).toHaveBeenCalledWith('/api/auto-recharge', expect.any(Object))
  })

  it('saves auto-recharge config with PUT semantics', async () => {
    const fetchFn = makeFetch([{ config: null }, { config }])
    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.save({
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 5,
        topupMode: 'fixed',
        topupAmountMajor: 10,
        currency: 'USD',
      })
    })

    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/auto-recharge',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(result.current.config).toMatchObject({ enabled: true })
  })
})
