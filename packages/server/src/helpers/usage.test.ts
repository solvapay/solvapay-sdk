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

import { createSolvaPay } from '../factory'
import { getAuthenticatedUserCore } from './auth'
import { trackUsageCore } from './usage'

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
    mockTrackUsage.mockResolvedValue(undefined)

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
    })

    expect(result).toEqual({ success: true })
  })

  it('returns success result when tracking succeeds', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: null,
      name: null,
    })

    const result = await trackUsageCore(fakeRequest(), { units: 1 })

    expect(result).toEqual({ success: true })
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
