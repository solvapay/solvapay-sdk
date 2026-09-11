import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('./customer', () => ({
  syncCustomerCore: vi.fn(),
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
import { syncCustomerCore } from './customer'
import { getPaymentMethodCore } from './payment-method'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)
const mockSyncCustomer = vi.mocked(syncCustomerCore)

describe('getPaymentMethodCore', () => {
  const mockGetPaymentMethod = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    mockGetPaymentMethod.mockResolvedValue({ kind: 'none' })
    mockCreateSolvaPay.mockReturnValue({
      apiClient: { getPaymentMethod: mockGetPaymentMethod },
    } as never)
  })

  it('returns the payment method on the happy path', async () => {
    mockGetPaymentMethod.mockResolvedValue({
      kind: 'card',
      brand: 'visa',
      last4: '4242',
    })

    const result = await getPaymentMethodCore(new Request('http://localhost'), {
      solvaPay: {
        apiClient: { getPaymentMethod: mockGetPaymentMethod },
      } as never,
    })

    expect(mockSyncCustomer).toHaveBeenCalled()
    expect(mockGetPaymentMethod).toHaveBeenCalledWith({ customerRef: 'cus_ABC' })
    expect(result).toEqual({ kind: 'card', brand: 'visa', last4: '4242' })
  })

  it('returns kind none when no card is on file', async () => {
    const result = await getPaymentMethodCore(new Request('http://localhost'), {
      solvaPay: {
        apiClient: { getPaymentMethod: mockGetPaymentMethod },
      } as never,
    })

    expect(result).toEqual({ kind: 'none' })
  })

  it('propagates syncCustomerCore errors verbatim', async () => {
    mockSyncCustomer.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await getPaymentMethodCore(new Request('http://localhost'))

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
    expect(mockGetPaymentMethod).not.toHaveBeenCalled()
  })

  it('returns 500 when getPaymentMethod is missing on the API client', async () => {
    const result = await getPaymentMethodCore(new Request('http://localhost'), {
      solvaPay: { apiClient: {} } as never,
    })

    expect(result).toEqual({
      error: 'getPaymentMethod is not implemented on this API client',
      status: 500,
    })
  })

  it('wraps thrown errors with handleRouteError', async () => {
    mockGetPaymentMethod.mockRejectedValue(new Error('Backend exploded'))

    const result = await getPaymentMethodCore(new Request('http://localhost'), {
      solvaPay: {
        apiClient: { getPaymentMethod: mockGetPaymentMethod },
      } as never,
    })

    expect(result).toEqual({
      error: 'Failed to load payment method',
      status: 500,
    })
  })

  it('uses createSolvaPay when no instance is provided', async () => {
    await getPaymentMethodCore(new Request('http://localhost'))

    expect(mockCreateSolvaPay).toHaveBeenCalled()
    expect(mockGetPaymentMethod).toHaveBeenCalledWith({ customerRef: 'cus_ABC' })
  })
})
