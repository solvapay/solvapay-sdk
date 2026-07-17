import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SolvaPayError } from '@solvapay/core'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('./error', () => ({
  handleRouteError: vi.fn((_error: unknown, opName: string, msg?: string) => ({
    error: msg || `${opName} failed`,
    status: 500,
  })),
}))

import { createSolvaPay } from '../factory'
import { cancelPurchaseCore, reactivatePurchaseCore } from './renewal'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)

async function flushSettleDelay(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500)
}

describe('cancelPurchaseCore', () => {
  const mockCancelPurchase = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockCreateSolvaPay.mockReturnValue({
      apiClient: { cancelPurchase: mockCancelPurchase },
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects missing purchaseRef with status 400', async () => {
    const result = await cancelPurchaseCore(new Request('http://localhost'), {
      purchaseRef: '',
    })
    expect(result).toEqual({
      error: 'Missing required parameter: purchaseRef is required',
      status: 400,
    })
    expect(mockCancelPurchase).not.toHaveBeenCalled()
  })

  it('returns 500 when cancelPurchase is unavailable on the client', async () => {
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: {} } as never },
    )
    expect(result).toEqual({
      error: 'Cancel purchase method not available on SDK client',
      status: 500,
    })
  })

  it('returns 500 for a non-object cancel response', async () => {
    mockCancelPurchase.mockResolvedValue(null)
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Invalid response from cancel purchase endpoint',
      status: 500,
    })
  })

  it('unwraps nested purchase and returns on cancelled status', async () => {
    mockCancelPurchase.mockResolvedValue({
      purchase: {
        reference: 'pur_1',
        status: 'cancelled',
      },
    })
    const resultPromise = cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    await flushSettleDelay()
    await expect(resultPromise).resolves.toEqual({
      reference: 'pur_1',
      status: 'cancelled',
    })
  })

  it('accepts cancelledAt as proof of cancellation', async () => {
    mockCancelPurchase.mockResolvedValue({
      reference: 'pur_1',
      status: 'active',
      cancelledAt: '2026-07-01T00:00:00Z',
    })
    const resultPromise = cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    await flushSettleDelay()
    await expect(resultPromise).resolves.toMatchObject({
      reference: 'pur_1',
      cancelledAt: '2026-07-01T00:00:00Z',
    })
  })

  it('returns 500 when reference is missing', async () => {
    mockCancelPurchase.mockResolvedValue({ status: 'cancelled' })
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Cancel purchase response missing required fields',
      status: 500,
    })
  })

  it('returns dynamic 500 when neither cancelled status nor cancelledAt', async () => {
    mockCancelPurchase.mockResolvedValue({
      reference: 'pur_1',
      status: 'active',
    })
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error:
        "Purchase cancellation failed: backend returned status 'active' without cancelledAt timestamp",
      status: 500,
    })
  })

  it('classifies SolvaPayError not-found as 404', async () => {
    mockCancelPurchase.mockRejectedValue(new SolvaPayError('Purchase pur_1 not found'))
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase not found',
      status: 404,
      details: 'Purchase pur_1 not found',
    })
  })

  it('classifies cannot-be-cancelled as 400', async () => {
    mockCancelPurchase.mockRejectedValue(
      new SolvaPayError('Purchase cannot be cancelled in current state'),
    )
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase cannot be cancelled or does not belong to provider',
      status: 400,
      details: 'Purchase cannot be cancelled in current state',
    })
  })

  it('classifies does-not-belong as 400', async () => {
    mockCancelPurchase.mockRejectedValue(
      new SolvaPayError('Purchase does not belong to provider'),
    )
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase cannot be cancelled or does not belong to provider',
      status: 400,
      details: 'Purchase does not belong to provider',
    })
  })

  it('falls through other SolvaPayError messages to 500 with details', async () => {
    mockCancelPurchase.mockRejectedValue(new SolvaPayError('upstream boom'))
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'upstream boom',
      status: 500,
      details: 'upstream boom',
    })
  })

  it('wraps non-SolvaPayError throws with handleRouteError', async () => {
    mockCancelPurchase.mockRejectedValue(new Error('network'))
    const result = await cancelPurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { cancelPurchase: mockCancelPurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Failed to cancel purchase',
      status: 500,
    })
  })
})

describe('reactivatePurchaseCore', () => {
  const mockReactivatePurchase = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockCreateSolvaPay.mockReturnValue({
      apiClient: { reactivatePurchase: mockReactivatePurchase },
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects missing purchaseRef with status 400', async () => {
    const result = await reactivatePurchaseCore(new Request('http://localhost'), {
      purchaseRef: '',
    })
    expect(result).toEqual({
      error: 'Missing required parameter: purchaseRef is required',
      status: 400,
    })
    expect(mockReactivatePurchase).not.toHaveBeenCalled()
  })

  it('returns 500 when reactivatePurchase is unavailable on the client', async () => {
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: {} } as never },
    )
    expect(result).toEqual({
      error: 'Reactivate purchase method not available on SDK client',
      status: 500,
    })
  })

  it('returns 500 for a non-object reactivate response', async () => {
    mockReactivatePurchase.mockResolvedValue(null)
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Invalid response from reactivate purchase endpoint',
      status: 500,
    })
  })

  it('unwraps nested purchase on happy path', async () => {
    mockReactivatePurchase.mockResolvedValue({
      purchase: {
        reference: 'pur_1',
        status: 'active',
      },
    })
    const resultPromise = reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    await flushSettleDelay()
    await expect(resultPromise).resolves.toEqual({
      reference: 'pur_1',
      status: 'active',
    })
  })

  it('returns 500 when reference is missing', async () => {
    mockReactivatePurchase.mockResolvedValue({ status: 'active' })
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Reactivate purchase response missing required fields',
      status: 500,
    })
  })

  it('returns 500 when cancelledAt is still set', async () => {
    mockReactivatePurchase.mockResolvedValue({
      reference: 'pur_1',
      cancelledAt: '2026-07-01T00:00:00Z',
    })
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase reactivation failed: cancelledAt is still set',
      status: 500,
    })
  })

  it('classifies SolvaPayError not-found as 404', async () => {
    mockReactivatePurchase.mockRejectedValue(new SolvaPayError('Purchase pur_1 not found'))
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase not found',
      status: 404,
      details: 'Purchase pur_1 not found',
    })
  })

  it('classifies cannot-be-reactivated as 400', async () => {
    mockReactivatePurchase.mockRejectedValue(
      new SolvaPayError('Purchase cannot be reactivated'),
    )
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase cannot be reactivated',
      status: 400,
      details: 'Purchase cannot be reactivated',
    })
  })

  it('classifies not-pending-cancellation as 400', async () => {
    mockReactivatePurchase.mockRejectedValue(
      new SolvaPayError('Purchase is not pending cancellation'),
    )
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase cannot be reactivated',
      status: 400,
      details: 'Purchase is not pending cancellation',
    })
  })

  it('classifies already-fully-cancelled as 400', async () => {
    mockReactivatePurchase.mockRejectedValue(
      new SolvaPayError('Purchase has already been fully cancelled'),
    )
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase cannot be reactivated',
      status: 400,
      details: 'Purchase has already been fully cancelled',
    })
  })

  it('classifies already-ended as 400', async () => {
    mockReactivatePurchase.mockRejectedValue(new SolvaPayError('Purchase already ended'))
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'Purchase cannot be reactivated',
      status: 400,
      details: 'Purchase already ended',
    })
  })

  it('falls through other SolvaPayError messages to 500 with details', async () => {
    mockReactivatePurchase.mockRejectedValue(new SolvaPayError('upstream boom'))
    const result = await reactivatePurchaseCore(
      new Request('http://localhost'),
      { purchaseRef: 'pur_1' },
      { solvaPay: { apiClient: { reactivatePurchase: mockReactivatePurchase } } as never },
    )
    expect(result).toEqual({
      error: 'upstream boom',
      status: 500,
      details: 'upstream boom',
    })
  })
})
