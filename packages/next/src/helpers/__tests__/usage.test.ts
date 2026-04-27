import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@solvapay/server', () => ({
  trackUsageCore: vi.fn(),
  isErrorResult: vi.fn((r: unknown) =>
    typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
}))

import { trackUsageCore } from '@solvapay/server'
import { trackUsage } from '../usage'

const mockTrackUsageCore = vi.mocked(trackUsageCore)

function fakeRequest(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/track-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('trackUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns NextResponse error when core returns error', async () => {
    mockTrackUsageCore.mockResolvedValue({
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

  it('passes body params and options to core helper', async () => {
    mockTrackUsageCore.mockResolvedValue({ success: true })

    const request = fakeRequest()
    await trackUsage(request, {
      actionType: 'api_call',
      units: 1,
      productRef: 'prd_XYZ',
      description: 'test query',
      metadata: { toolName: 'search' },
    })

    expect(mockTrackUsageCore).toHaveBeenCalledWith(
      request,
      {
        actionType: 'api_call',
        units: 1,
        productRef: 'prd_XYZ',
        description: 'test query',
        metadata: { toolName: 'search' },
      },
      {},
    )
  })

  it('returns success JSON when tracking succeeds', async () => {
    mockTrackUsageCore.mockResolvedValue({ success: true })

    const request = fakeRequest()
    const result = await trackUsage(request, { units: 1 })

    expect(result).toBeInstanceOf(NextResponse)
    const json = await (result as NextResponse).json()
    expect(json.success).toBe(true)
  })

  it('returns error response when core returns error from trackUsage failure', async () => {
    mockTrackUsageCore.mockResolvedValue({
      error: 'Track usage failed',
      status: 500,
      details: 'Insufficient credits',
    })

    const request = fakeRequest()
    const result = await trackUsage(request, { units: 1 })

    expect(result).toBeInstanceOf(NextResponse)
    const json = await (result as NextResponse).json()
    expect(json.error).toBeDefined()
    expect((result as NextResponse).status).toBe(500)
  })

  it('passes custom solvaPay instance to core', async () => {
    mockTrackUsageCore.mockResolvedValue({ success: true })

    const customSolvaPay = { trackUsage: vi.fn() } as never
    const request = fakeRequest()
    await trackUsage(request, { units: 2 }, { solvaPay: customSolvaPay })

    expect(mockTrackUsageCore).toHaveBeenCalledWith(
      request,
      { units: 2 },
      { solvaPay: customSolvaPay },
    )
  })
})
