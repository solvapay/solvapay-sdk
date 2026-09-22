import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('../client', () => ({
  createSolvaPayClient: vi.fn(),
}))

vi.mock('@solvapay/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@solvapay/core')>()
  return {
    ...actual,
    getSolvaPayConfig: vi.fn(),
  }
})

vi.mock('./error', () => ({
  handleRouteError: vi.fn((_error: unknown, opName: string, msg?: string) => ({
    error: msg || `${opName} failed`,
    status: 500,
  })),
}))

import { getSolvaPayConfig } from '@solvapay/core'
import { listPlansCore } from './plans'

const mockGetConfig = vi.mocked(getSolvaPayConfig)

describe('listPlansCore', () => {
  const mockListPlans = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockListPlans.mockResolvedValue([{ reference: 'pln_1', name: 'Basic' }])
    mockGetConfig.mockReturnValue({ apiKey: 'sk_test' })
  })

  it('rejects missing productRef with status 400', async () => {
    const result = await listPlansCore(new Request('http://localhost/api/plans'))
    expect(result).toEqual({
      error: 'Missing required parameter: productRef',
      status: 400,
    })
    expect(mockListPlans).not.toHaveBeenCalled()
  })

  it('returns plans and productRef on the happy path', async () => {
    const result = await listPlansCore(new Request('http://localhost/api/plans?productRef=prd_1'), {
      solvaPay: {
        apiClient: { listPlans: mockListPlans },
      } as never,
    })

    expect(mockListPlans).toHaveBeenCalledWith('prd_1')
    expect(result).toEqual({
      plans: [{ reference: 'pln_1', name: 'Basic' }],
      productRef: 'prd_1',
    })
  })

  it('falls back to an empty plans array when listPlans returns nullish', async () => {
    mockListPlans.mockResolvedValue(null)

    const result = await listPlansCore(new Request('http://localhost/api/plans?productRef=prd_1'), {
      solvaPay: {
        apiClient: { listPlans: mockListPlans },
      } as never,
    })

    expect(result).toEqual({
      plans: [],
      productRef: 'prd_1',
    })
  })

  it('returns 500 when listPlans is unavailable on the client', async () => {
    const result = await listPlansCore(new Request('http://localhost/api/plans?productRef=prd_1'), {
      solvaPay: { apiClient: {} } as never,
    })

    expect(result).toEqual({
      error: 'List plans method not available',
      status: 500,
    })
  })

  it('returns 500 when secret key config is missing and no solvaPay is provided', async () => {
    mockGetConfig.mockImplementation(() => {
      throw new Error('missing key')
    })

    // When getSolvaPayConfig throws, createSolvaPayClient path fails via the
    // IIFE — but the helper catches config via try around the whole body.
    // With no apiKey path: the IIFE returns null only when config.apiKey is falsy.
    mockGetConfig.mockReturnValue({ apiKey: '' })

    const result = await listPlansCore(new Request('http://localhost/api/plans?productRef=prd_1'))

    expect(result).toEqual({
      error: 'Server configuration error: SolvaPay secret key not configured',
      status: 500,
    })
  })

  it('wraps thrown errors with handleRouteError', async () => {
    mockListPlans.mockRejectedValue(new Error('Backend exploded'))

    const result = await listPlansCore(new Request('http://localhost/api/plans?productRef=prd_1'), {
      solvaPay: {
        apiClient: { listPlans: mockListPlans },
      } as never,
    })

    expect(result).toEqual({
      error: 'Failed to fetch plans',
      status: 500,
    })
  })
})
