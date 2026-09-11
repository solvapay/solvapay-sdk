import { describe, it, expect, vi } from 'vitest'
import { reconcilePayment } from './processPaymentResult'
import { enCopy } from '../i18n/en'

describe('reconcilePayment', () => {
  it('propagates the processPaymentIntent result on success and does not refetch', async () => {
    const upstream = {
      status: 'succeeded',
      type: 'recurring',
      purchase: {
        reference: 'pur_test',
        productName: 'Widget',
        status: 'active',
        startDate: '2026-05-12T00:00:00Z',
        amount: 1999,
        currency: 'usd',
      },
    }
    const processPayment = vi.fn().mockResolvedValue(upstream)
    const refetch = vi.fn().mockResolvedValue(undefined)
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('success')
    expect(result.status === 'success' && result.result).toEqual(upstream)
    expect(processPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi',
      productRef: 'prd',
      planRef: undefined,
    })
    // Synchronous merge via the caller's `upsertPurchase` replaces the
    // previous internal refetch — see fix-lifetime-badge-stale plan.
    expect(refetch).not.toHaveBeenCalled()
  })

  it('propagates a bare `succeeded` result so the caller can refetch on the webhook race', async () => {
    const processPayment = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const refetch = vi.fn().mockResolvedValue(undefined)
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('success')
    expect(result.status === 'success' && result.result).toEqual({ status: 'succeeded' })
    // No internal refetch — the PaymentForm caller owns the fallback so
    // free/paid/topup branches can route consistently.
    expect(refetch).not.toHaveBeenCalled()
  })

  it('routes a `processing` result to pending with the standard pending copy', async () => {
    const processPayment = vi.fn().mockResolvedValue({ status: 'processing' })
    const refetch = vi.fn()
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('pending')
    expect(result.status === 'pending' && result.error.message).toBe(enCopy.errors.paymentPending)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('routes a `failed` result to error with the standard processing-failed copy', async () => {
    const processPayment = vi.fn().mockResolvedValue({ status: 'failed' })
    const refetch = vi.fn()
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('error')
    expect(result.status === 'error' && result.error.message).toBe(
      enCopy.errors.paymentProcessingFailed,
    )
    expect(refetch).not.toHaveBeenCalled()
  })

  it('routes a `cancelled` result to error with the standard processing-failed copy', async () => {
    const processPayment = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const refetch = vi.fn()
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      productRef: 'prd',
      processPayment,
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('error')
    expect(result.status === 'error' && result.error.message).toBe(
      enCopy.errors.paymentProcessingFailed,
    )
    expect(refetch).not.toHaveBeenCalled()
  })

  it('falls back to refetch on the legacy `!processPayment` path with no result', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    const result = await reconcilePayment({
      paymentIntentId: 'pi',
      refetchPurchase: refetch,
      copy: enCopy,
    })
    expect(result.status).toBe('success')
    expect(result.status === 'success' && result.result).toBeUndefined()
    expect(refetch).toHaveBeenCalledTimes(1)
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
