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
import { checkLimitsCore } from './limits'

const mockGetAuth = vi.mocked(getAuthenticatedUserCore)
const mockCreateSolvaPay = vi.mocked(createSolvaPay)

describe('checkLimitsCore', () => {
  const mockCheckLimits = vi.fn()
  const mockEnsureCustomer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureCustomer.mockResolvedValue('cus_ABC')
    mockCheckLimits.mockResolvedValue({
      withinLimits: true,
      remaining: 42,
      meterName: 'requests',
    })
    mockCreateSolvaPay.mockReturnValue({
      ensureCustomer: mockEnsureCustomer,
      apiClient: { checkLimits: mockCheckLimits },
    } as never)
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'test@example.com',
      name: 'Test',
    })
  })

  it('rejects missing productRef with status 400', async () => {
    const result = await checkLimitsCore(new Request('http://localhost/api/limits'))
    expect(result).toEqual({
      error: 'Missing required parameter: productRef',
      status: 400,
    })
    expect(mockCheckLimits).not.toHaveBeenCalled()
  })

  it('defaults meterName to requests when omitted', async () => {
    const result = await checkLimitsCore(
      new Request('http://localhost/api/limits?productRef=prd_1'),
      {
        solvaPay: {
          ensureCustomer: mockEnsureCustomer,
          apiClient: { checkLimits: mockCheckLimits },
        } as never,
      },
    )

    expect(mockCheckLimits).toHaveBeenCalledWith({
      customerRef: 'cus_ABC',
      productRef: 'prd_1',
      meterName: 'requests',
    })
    expect(result).toEqual({
      withinLimits: true,
      remaining: 42,
      meterName: 'requests',
    })
  })

  it('forwards an explicit meterName', async () => {
    await checkLimitsCore(
      new Request('http://localhost/api/limits?productRef=prd_1&meterName=api_calls'),
      {
        solvaPay: {
          ensureCustomer: mockEnsureCustomer,
          apiClient: { checkLimits: mockCheckLimits },
        } as never,
      },
    )

    expect(mockCheckLimits).toHaveBeenCalledWith({
      customerRef: 'cus_ABC',
      productRef: 'prd_1',
      meterName: 'api_calls',
    })
  })

  it('propagates auth errors verbatim', async () => {
    mockGetAuth.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await checkLimitsCore(
      new Request('http://localhost/api/limits?productRef=prd_1'),
    )

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
    expect(mockCheckLimits).not.toHaveBeenCalled()
  })

  it('wraps thrown errors with handleRouteError', async () => {
    mockCheckLimits.mockRejectedValue(new Error('Backend exploded'))

    const result = await checkLimitsCore(
      new Request('http://localhost/api/limits?productRef=prd_1'),
      {
        solvaPay: {
          ensureCustomer: mockEnsureCustomer,
          apiClient: { checkLimits: mockCheckLimits },
        } as never,
      },
    )

    expect(result).toEqual({
      error: 'Failed to check limits',
      status: 500,
    })
  })
})
