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
import { checkPurchaseCore } from './purchase'

const mockGetAuth = vi.mocked(getAuthenticatedUserCore)
const mockCreateSolvaPay = vi.mocked(createSolvaPay)

function fakeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/check-purchase', {
    headers,
  })
}

describe('checkPurchaseCore', () => {
  const mockEnsureCustomer = vi.fn()
  const mockGetCustomer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    mockEnsureCustomer.mockResolvedValue('cus_ABC')
    mockGetCustomer.mockResolvedValue({
      customerRef: 'cus_ABC',
      email: 'user@example.com',
      name: 'Test User',
      externalRef: 'user_123',
      purchases: [
        { reference: 'pur_1', status: 'active', productRef: 'prd_1' },
        { reference: 'pur_2', status: 'cancelled', productRef: 'prd_2' },
      ],
    })

    mockCreateSolvaPay.mockReturnValue({
      ensureCustomer: mockEnsureCustomer,
      getCustomer: mockGetCustomer,
    } as never)
  })

  it('returns error when authentication fails', async () => {
    mockGetAuth.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await checkPurchaseCore(fakeRequest())

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
  })

  it('returns customer data with only active purchases on success', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'user@example.com',
      name: 'Test User',
    })

    const result = await checkPurchaseCore(fakeRequest())

    expect(result).toEqual({
      customerRef: 'cus_ABC',
      email: 'user@example.com',
      name: 'Test User',
      purchases: [{ reference: 'pur_1', status: 'active', productRef: 'prd_1' }],
    })
  })

  it('fast-path: validates cached customerRef header and returns immediately', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'user@example.com',
      name: 'Test User',
    })

    const request = fakeRequest({ 'x-solvapay-customer-ref': 'cus_ABC' })
    const result = await checkPurchaseCore(request)

    expect(mockGetCustomer).toHaveBeenCalledWith({ customerRef: 'cus_ABC' })
    expect(result).toEqual({
      customerRef: 'cus_ABC',
      email: 'user@example.com',
      name: 'Test User',
      purchases: [{ reference: 'pur_1', status: 'active', productRef: 'prd_1' }],
    })
    expect(mockEnsureCustomer).not.toHaveBeenCalled()
  })

  it('fast-path: falls through when externalRef does not match userId', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_999',
      email: 'other@example.com',
      name: 'Other User',
    })

    const request = fakeRequest({ 'x-solvapay-customer-ref': 'cus_ABC' })
    const result = await checkPurchaseCore(request)

    // Should have called ensureCustomer because fast path failed
    expect(mockEnsureCustomer).toHaveBeenCalledWith('user_999', 'user_999', {
      email: 'other@example.com',
      name: 'Other User',
    })
    expect(result).toMatchObject({ customerRef: 'cus_ABC' })
  })

  it('fast-path: falls through when getCustomer throws', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'user@example.com',
      name: 'Test User',
    })

    // First call (fast path) throws, second call (normal path) succeeds
    mockGetCustomer
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce({
        customerRef: 'cus_ABC',
        email: 'user@example.com',
        name: 'Test User',
        purchases: [{ reference: 'pur_1', status: 'active', productRef: 'prd_1' }],
      })

    const request = fakeRequest({ 'x-solvapay-customer-ref': 'cus_STALE' })
    const result = await checkPurchaseCore(request)

    expect(mockEnsureCustomer).toHaveBeenCalled()
    expect(result).toMatchObject({ customerRef: 'cus_ABC' })
  })

  it('returns empty purchases when customer lookup fails', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_new',
      email: null,
      name: null,
    })
    mockEnsureCustomer.mockRejectedValue(new Error('API error'))

    const result = await checkPurchaseCore(fakeRequest())

    expect(result).toMatchObject({
      customerRef: 'user_new',
      purchases: [],
    })
  })

  it('passes email and name as undefined when not available', async () => {
    mockGetAuth.mockResolvedValue({
      userId: 'user_456',
      email: null,
      name: null,
    })

    await checkPurchaseCore(fakeRequest())

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
      getCustomer: mockGetCustomer,
    } as never

    await checkPurchaseCore(fakeRequest(), { solvaPay: customSolvaPay })

    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })
})
