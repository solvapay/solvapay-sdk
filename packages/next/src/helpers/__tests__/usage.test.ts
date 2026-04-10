import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@solvapay/server', () => ({
  getAuthenticatedUserCore: vi.fn(),
  isErrorResult: vi.fn((r: unknown) =>
    typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
  createSolvaPay: vi.fn(),
}))

import { getAuthenticatedUserCore, createSolvaPay } from '@solvapay/server'
import { trackUsage } from '../usage'

const mockGetAuth = vi.mocked(getAuthenticatedUserCore)
const mockCreateSolvaPay = vi.mocked(createSolvaPay)

function fakeRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/track-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('trackUsage', () => {
  const mockTrackUsage = vi.fn()
  const mockEnsureCustomer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockEnsureCustomer.mockResolvedValue('cus_ABC')
    mockTrackUsage.mockResolvedValue(undefined)

    mockCreateSolvaPay.mockReturnValue({
      ensureCustomer: mockEnsureCustomer,
      trackUsage: mockTrackUsage,
    } as any)
  })

  it('returns NextResponse error when auth fails', async () => {
    mockGetAuth.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const request = fakeRequest()
    const result = await trackUsage(request, { units: 1 })

    expect(result).toBeInstanceOf(NextResponse)
    const json = await (result as NextResponse).json()
    expect(json.error).toBe('Unauthorized')
    expect((result as NextResponse).status).toBe(401)
  })

  it('calls solvaPay.trackUsage with authenticated customer ref and body params', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'test@example.com',
      name: 'Test',
    })

    const request = fakeRequest()
    await trackUsage(request, {
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
  })

  it('returns success JSON when tracking succeeds', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: null,
      name: null,
    })

    const request = fakeRequest()
    const result = await trackUsage(request, { units: 1 })

    expect(result).toBeInstanceOf(NextResponse)
    const json = await (result as NextResponse).json()
    expect(json.success).toBe(true)
  })

  it('returns error response when solvaPay.trackUsage throws', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: null,
      name: null,
    })
    mockTrackUsage.mockRejectedValue(new Error('Track usage failed (402): Insufficient credits'))

    const request = fakeRequest()
    const result = await trackUsage(request, { units: 1 })

    expect(result).toBeInstanceOf(NextResponse)
    const json = await (result as NextResponse).json()
    expect(json.error).toBeDefined()
    expect((result as NextResponse).status).toBe(500)
  })

  it('passes undefined email/name to ensureCustomer when not available', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_456',
      email: null,
      name: null,
    })

    const request = fakeRequest()
    await trackUsage(request, { units: 2 })

    expect(mockEnsureCustomer).toHaveBeenCalledWith('user_456', 'user_456', {
      email: undefined,
      name: undefined,
    })
  })
})
