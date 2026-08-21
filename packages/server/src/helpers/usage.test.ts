import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as factory from '../factory'
import * as auth from './auth'
import * as purchase from './purchase'
import { getUsageCore, trackUsageCore } from './usage'

const mockCreateSolvaPay = vi.fn()
const mockGetAuth = vi.fn()
const mockCheckPurchase = vi.fn()

function fakeRequest() {
  return new Request('http://localhost/api/track-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('getUsageCore', () => {
  beforeEach(() => {
    mockCheckPurchase.mockReset()
    vi.spyOn(purchase, 'checkPurchaseCore').mockImplementation(mockCheckPurchase)
  })

  it('propagates checkPurchaseCore errors verbatim', async () => {
    mockCheckPurchase.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await getUsageCore(fakeRequest())

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
  })

  it('returns an empty snapshot when no active purchase exists', async () => {
    mockCheckPurchase.mockResolvedValue({
      customerRef: 'cus_ABC',
      purchases: [{ reference: 'pur_1', status: 'cancelled' }],
    })

    const result = await getUsageCore(fakeRequest())

    expect(result).toEqual({
      meterRef: null,
      total: null,
      used: 0,
      remaining: null,
      percentUsed: null,
    })
  })

  it('projects usage from the active purchase planSnapshot', async () => {
    mockCheckPurchase.mockResolvedValue({
      customerRef: 'cus_ABC',
      purchases: [
        {
          reference: 'pur_1',
          status: 'active',
          planSnapshot: { meterRef: 'mtr_requests', limit: 100 },
          usage: {
            used: 25,
            periodStart: '2026-07-01T00:00:00Z',
            periodEnd: '2026-08-01T00:00:00Z',
          },
        },
      ],
    })

    const result = await getUsageCore(fakeRequest())

    expect(result).toEqual({
      meterRef: 'mtr_requests',
      total: 100,
      used: 25,
      remaining: 75,
      percentUsed: 25,
      periodStart: '2026-07-01T00:00:00Z',
      periodEnd: '2026-08-01T00:00:00Z',
      purchaseRef: 'pur_1',
    })
  })

  it('falls back to meterId when meterRef is absent', async () => {
    mockCheckPurchase.mockResolvedValue({
      customerRef: 'cus_ABC',
      purchases: [
        {
          reference: 'pur_1',
          status: 'active',
          planSnapshot: { meterId: 'mtr_legacy', limit: 10 },
          usage: { used: 2 },
        },
      ],
    })

    const result = await getUsageCore(fakeRequest())

    expect(result).toMatchObject({
      meterRef: 'mtr_legacy',
      total: 10,
      used: 2,
      remaining: 8,
      percentUsed: 20,
      purchaseRef: 'pur_1',
    })
  })

  it('clamps remaining and percentUsed when usage exceeds the limit', async () => {
    mockCheckPurchase.mockResolvedValue({
      customerRef: 'cus_ABC',
      purchases: [
        {
          reference: 'pur_1',
          status: 'active',
          planSnapshot: { meterRef: 'mtr_requests', limit: 10 },
          usage: { used: 50 },
        },
      ],
    })

    const result = await getUsageCore(fakeRequest())

    expect(result).toMatchObject({
      remaining: 0,
      percentUsed: 100,
    })
  })
})

describe('trackUsageCore', () => {
  const mockTrackUsage = vi.fn()
  const mockEnsureCustomer = vi.fn()

  beforeEach(() => {
    mockGetAuth.mockReset()
    mockEnsureCustomer.mockReset()
    mockTrackUsage.mockReset()
    mockCreateSolvaPay.mockReset()
    vi.spyOn(auth, 'getAuthenticatedUserCore').mockImplementation(mockGetAuth)
    vi.spyOn(factory, 'createSolvaPay').mockImplementation(mockCreateSolvaPay)
    mockEnsureCustomer.mockResolvedValue('cus_ABC')
    mockTrackUsage.mockResolvedValue({
      success: true,
      reference: 'usage_123',
      creditDebit: { debited: true, amount: 10, unitsRemaining: 99 },
    })

    mockCreateSolvaPay.mockReturnValue({
      ensureCustomer: mockEnsureCustomer,
      trackUsage: mockTrackUsage,
    } as never)
  })

  it('returns error when authentication fails', async () => {
    mockGetAuth.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await trackUsageCore(fakeRequest(), { units: 1 })

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
  })

  it('calls solvaPay.trackUsage with authenticated customer ref and body params', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'test@example.com',
      name: 'Test',
    })

    const result = await trackUsageCore(fakeRequest(), {
      actionType: 'api_call',
      units: 1,
      productRef: 'prd_XYZ',
      description: 'test query',
      metadata: { toolName: 'search' },
      idempotencyKey: 'usage_key_123',
    })

    expect(mockEnsureCustomer).toHaveBeenCalledWith('user_123', 'user_123', {
      email: 'test@example.com',
      name: 'Test',
    })

    expect(mockTrackUsage).toHaveBeenCalledWith({
      customerRef: 'cus_ABC',
      actionType: 'api_call',
      units: 1,
      productRef: 'prd_XYZ',
      description: 'test query',
      metadata: { toolName: 'search' },
      idempotencyKey: 'usage_key_123',
    })

    expect(result).toEqual({
      success: true,
      reference: 'usage_123',
      creditDebit: { debited: true, amount: 10, unitsRemaining: 99 },
    })
  })

  it('returns the backend usage result when tracking succeeds', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: null,
      name: null,
    })

    const result = await trackUsageCore(fakeRequest(), { units: 1 })

    expect(result).toEqual({
      success: true,
      reference: 'usage_123',
      creditDebit: { debited: true, amount: 10, unitsRemaining: 99 },
    })
  })

  it('returns error when solvaPay.trackUsage throws', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: null,
      name: null,
    })
    mockTrackUsage.mockRejectedValue(new Error('Insufficient credits'))

    const result = await trackUsageCore(fakeRequest(), { units: 1 })

    expect(result).toMatchObject({
      error: expect.any(String),
      status: 500,
    })
  })

  it('passes undefined email/name to ensureCustomer when not available', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_456',
      email: null,
      name: null,
    })

    await trackUsageCore(fakeRequest(), { units: 2 })

    expect(mockEnsureCustomer).toHaveBeenCalledWith('user_456', 'user_456', {
      email: undefined,
      name: undefined,
    })
  })

  it('uses provided solvaPay instance', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: null,
      name: null,
    })

    const customSolvaPay = {
      ensureCustomer: mockEnsureCustomer,
      trackUsage: mockTrackUsage,
    } as never

    await trackUsageCore(fakeRequest(), { units: 1 }, { solvaPay: customSolvaPay })

    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })
})
