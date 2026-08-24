import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolvaPayProvider } from '../../SolvaPayProvider'
import {
  autoRechargeCache,
  CACHE_DURATION,
  autoRechargeCacheKeyFor,
  invalidateAutoRecharge,
} from '../autoRechargeCache'
import { useAutoRecharge } from '../useAutoRecharge'
import type { AutoRechargeConfig } from '@solvapay/server'

const config: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdAmountMinor: 500 },
  topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
  fundingSourceType: 'saved_card',
  paymentMethodId: 'pm_123',
  status: 'active',
  failureCount: 0,
  monthlySpendMinor: 0,
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

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
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
      trigger: { type: 'balance', thresholdAmountMinor: 500 },
    })
    expect(fetchFn).toHaveBeenCalledWith('/api/auto-recharge', expect.any(Object))
  })

  it('saves auto-recharge config with PUT semantics', async () => {
    const savedDisplay = {
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
      formatted: { threshold: '$5', topup: '$10' },
      exchangeRate: 1,
      rateSource: 'parity' as const,
    }
    const fetchFn = makeFetch([
      { config: null },
      { config, display: savedDisplay },
    ])
    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.save({
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        currency: 'USD',
      })
    })

    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/auto-recharge',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(result.current.config).toMatchObject({
      enabled: true,
      display: savedDisplay,
    })
  })

  it('optimistically disables config when refresh fails after DELETE', async () => {
    let getCount = 0
    const fetchFn = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      getCount += 1
      if (getCount > 1) {
        return new Response(JSON.stringify({ message: 'refresh failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.config?.enabled).toBe(true)

    await act(async () => {
      await result.current.disable()
    })

    expect(result.current.config?.enabled).toBe(false)
    expect(result.current.error).not.toBeNull()
  })

  it('ignores a stale save response when disable completes later', async () => {
    const saveDeferred = makeDeferred<Response>()
    const disabledConfig: AutoRechargeConfig = { ...config, enabled: false }

    const fetchFn = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return saveDeferred.promise
      }
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ config: disabledConfig }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    let savePromise: Promise<unknown> | undefined
    await act(async () => {
      savePromise = result.current.save({
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        currency: 'USD',
      })
    })

    await act(async () => {
      await result.current.disable()
    })

    await act(async () => {
      saveDeferred.resolve(
        new Response(JSON.stringify({ config }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await savePromise
    })

    expect(result.current.config?.enabled).toBe(false)
  })

  it('ignores a stale refresh that would re-enable after disable completes', async () => {
    const refreshDeferred = makeDeferred<Response>()
    let getCount = 0

    const fetchFn = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      getCount += 1
      if (getCount === 1) {
        return new Response(JSON.stringify({ config }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return refreshDeferred.promise
    })

    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    let disablePromise: Promise<unknown> | undefined
    await act(async () => {
      disablePromise = result.current.disable()
    })

    expect(result.current.config?.enabled).toBe(false)

    await act(async () => {
      refreshDeferred.resolve(
        new Response(JSON.stringify({ config }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await disablePromise
    })

    expect(result.current.config?.enabled).toBe(false)
  })

  it('applies an edit save after disable when disable did not run', async () => {
    const editedConfig: AutoRechargeConfig = {
      ...config,
      trigger: { type: 'balance', thresholdAmountMinor: 700 },
    }

    const fetchFn = makeFetch([
      { config },
      { config: editedConfig },
    ])

    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.save({
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 7,
        topupAmountMajor: 10,
        currency: 'USD',
      })
    })

    expect(result.current.config?.trigger.thresholdAmountMinor).toBe(700)
  })

  it('forwards maxMonthlySpendMajor on save and exposes cap fields on reload', async () => {
    const cappedConfig: AutoRechargeConfig = {
      ...config,
      maxMonthlySpendMinor: 10_000,
      monthlySpendMinor: 2000,
      monthlySpendPeriod: '2026-07',
    }
    const fetchFn = makeFetch([{ config: null }, { config: cappedConfig }])

    const { result } = renderHook(() => useAutoRecharge(), {
      wrapper: wrapper({ fetch: fetchFn as unknown as typeof fetch }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.save({
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        maxMonthlySpendMajor: 100,
        currency: 'USD',
      })
    })

    const lastCall = fetchFn.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"maxMonthlySpendMajor":100'),
      }),
    )
    expect(result.current.config?.maxMonthlySpendMinor).toBe(10_000)
    expect(result.current.config?.monthlySpendMinor).toBe(2000)
  })

  it('syncs config to all hook instances after refresh on another instance', async () => {
    const initialConfig: AutoRechargeConfig = {
      ...config,
      maxMonthlySpendMinor: 10_000,
      monthlySpendMinor: 0,
      monthlySpendPeriod: '2026-07',
    }
    const updatedConfig: AutoRechargeConfig = {
      ...initialConfig,
      monthlySpendMinor: 4500,
    }
    const fetchFn = makeFetch([{ config: initialConfig }, { config: updatedConfig }])
    const providerConfig = { fetch: fetchFn as unknown as typeof fetch }
    const hookWrapper = wrapper(providerConfig)

    const { result: resultA } = renderHook(() => useAutoRecharge(), { wrapper: hookWrapper })
    const { result: resultB } = renderHook(() => useAutoRecharge(), { wrapper: hookWrapper })

    await waitFor(() => expect(resultA.current.loading).toBe(false))
    expect(resultA.current.config?.monthlySpendMinor).toBe(0)
    expect(resultB.current.config?.monthlySpendMinor).toBe(0)

    await act(async () => {
      await resultA.current.refresh(true)
    })

    await waitFor(() => {
      expect(resultA.current.config?.monthlySpendMinor).toBe(4500)
      expect(resultB.current.config?.monthlySpendMinor).toBe(4500)
    })
  })

  it('re-fetches on cache invalidation bypassing the TTL', async () => {
    const staleConfig: AutoRechargeConfig = {
      ...config,
      maxMonthlySpendMinor: 10_000,
      monthlySpendMinor: 0,
      monthlySpendPeriod: '2026-07',
    }
    const freshConfig: AutoRechargeConfig = {
      ...staleConfig,
      monthlySpendMinor: 4500,
    }
    const fetchFn = makeFetch([{ config: staleConfig }, { config: freshConfig }])
    const providerConfig = { fetch: fetchFn as unknown as typeof fetch }
    const hookWrapper = wrapper(providerConfig)

    const { result } = renderHook(() => useAutoRecharge(), { wrapper: hookWrapper })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.config?.monthlySpendMinor).toBe(0)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const key = autoRechargeCacheKeyFor(providerConfig)
    const cached = autoRechargeCache.get(key)
    expect(cached?.config?.monthlySpendMinor).toBe(0)
    autoRechargeCache.set(key, {
      config: cached?.config ?? null,
      promise: null,
      timestamp: Date.now() - CACHE_DURATION - 1,
    })

    await act(async () => {
      invalidateAutoRecharge(key)
    })

    await waitFor(() => {
      expect(result.current.config?.monthlySpendMinor).toBe(4500)
    })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
