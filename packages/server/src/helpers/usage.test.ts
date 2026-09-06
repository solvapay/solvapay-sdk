import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('./auth', () => ({
  getAuthenticatedUserCore: vi.fn(),
}))

vi.mock('./error', () => ({
  isErrorResult: vi.fn(
    (r: unknown) => typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
  handleRouteError: vi.fn((_error: unknown, opName: string, msg?: string) => ({
    error: msg || `${opName} failed`,
    status: 500,
  })),
}))

vi.mock('./purchase', () => ({
  checkPurchaseCore: vi.fn(),
}))

import { createSolvaPay } from '../factory'
import { getAuthenticatedUserCore } from './auth'
import { checkPurchaseCore } from './purchase'
import { deriveUsageSnapshot, getUsageCore, trackUsageCore } from './usage'

const mockCheckPurchase = vi.mocked(checkPurchaseCore)

const mockGetAuth = vi.mocked(getAuthenticatedUserCore)
const mockCreateSolvaPay = vi.mocked(createSolvaPay)

function fakeRequest() {
  return new Request('http://localhost/api/track-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('trackUsageCore', () => {
  const mockTrackUsage = vi.fn()
  const mockEnsureCustomer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

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

describe('deriveUsageSnapshot', () => {
  it('computes total from used + remaining when the cap is finite', () => {
    expect(
      deriveUsageSnapshot({
        used: 6200,
        purchaseRef: 'pur_1',
        periodStart: '2026-09-01T00:00:00.000Z',
        limits: { remaining: 3800, meterName: 'requests' },
      }),
    ).toEqual({
      meterRef: 'requests',
      total: 10000,
      used: 6200,
      remaining: 3800,
      percentUsed: 62,
      periodStart: '2026-09-01T00:00:00.000Z',
      purchaseRef: 'pur_1',
    })
  })

  it('treats remaining -1 as uncapped rather than a real count', () => {
    expect(deriveUsageSnapshot({ used: 10, limits: { remaining: -1 } })).toEqual({
      meterRef: null,
      total: null,
      used: 10,
      remaining: null,
      percentUsed: null,
    })
  })

  it('leaves the cap unknown when limits are null — never fakes unlimited', () => {
    expect(deriveUsageSnapshot({ used: 4, limits: null })).toEqual({
      meterRef: null,
      total: null,
      used: 4,
      remaining: null,
      percentUsed: null,
    })
  })
})

describe('getUsageCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a pre-fetched LimitResponse and does not call checkLimits', async () => {
    mockCheckPurchase.mockResolvedValue({
      customerRef: 'cus_1',
      purchases: [
        {
          status: 'active',
          productRef: 'prd_1',
          reference: 'pur_1',
          planSnapshot: { isMetered: true },
          usage: { used: 6200 },
        },
      ],
    } as never)
    const checkLimits = vi.fn()

    const result = await getUsageCore(fakeRequest(), {
      solvaPay: { apiClient: { checkLimits } } as never,
      limits: { remaining: 3800, meterName: 'requests' },
    })

    expect(checkLimits).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      used: 6200,
      remaining: 3800,
      total: 10000,
      meterRef: 'requests',
      purchaseRef: 'pur_1',
    })
  })

  it('skips checkLimits on a metered plan when the caller already supplied null limits', async () => {
    mockCheckPurchase.mockResolvedValue({
      customerRef: 'cus_1',
      purchases: [
        {
          status: 'active',
          productRef: 'prd_1',
          reference: 'pur_1',
          planSnapshot: { isMetered: true },
          usage: { used: 12 },
        },
      ],
    } as never)
    const checkLimits = vi.fn()

    const result = await getUsageCore(fakeRequest(), {
      solvaPay: { apiClient: { checkLimits } } as never,
      limits: null,
    })

    expect(checkLimits).not.toHaveBeenCalled()
    expect(result).toMatchObject({ used: 12, remaining: null, total: null })
  })
})
