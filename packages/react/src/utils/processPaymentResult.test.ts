import { describe, it, expect, vi } from 'vitest'
import { reconcilePayment } from './processPaymentResult'
import { enCopy } from '../i18n/en'

describe('reconcilePayment', () => {
  it('returns success when processPayment completes', async () => {
    const processPayment = vi.fn().mockResolvedValue({ status: 'completed' })
    const refetch = vi.fn().mockResolvedValue(undefined)
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('success')
    expect(processPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi',
      productRef: 'prd',
      planRef: undefined,
    })
    expect(refetch).toHaveBeenCalled()
  })

  it('refetches purchase even without processPayment', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('success')
    expect(refetch).toHaveBeenCalled()
  })

  it('returns timeout after retrying refetch 5 times', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const processPayment = vi.fn().mockResolvedValue({ status: 'timeout' })
    const refetch = vi.fn().mockResolvedValue(undefined)
    const promise = reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    await vi.advanceTimersByTimeAsync(20000)
    const result = await promise
    expect(result.status).toBe('timeout')
    expect(refetch).toHaveBeenCalledTimes(5)
    expect(result.status === 'timeout' && result.error.message).toMatch(/timed out/)
    vi.useRealTimers()
  })

  it('returns error when processPayment throws', async () => {
    const processPayment = vi.fn().mockRejectedValue(new Error('boom'))
    const refetch = vi.fn()
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('error')
    expect(result.status === 'error' && result.error.message).toBe('boom')
  })
})
