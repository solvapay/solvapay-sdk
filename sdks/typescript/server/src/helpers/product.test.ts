import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as core from '@solvapay/core'
import * as error from './error'
import { getProductCore } from './product'

describe('getProductCore', () => {
  const mockGetProduct = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetProduct.mockReset()
    mockGetProduct.mockResolvedValue({
      reference: 'prd_1',
      name: 'API Access',
    })
    vi.spyOn(core, 'getSolvaPayConfig').mockReturnValue({ apiKey: 'sk_test' })
    vi.spyOn(error, 'handleRouteError').mockImplementation(
      (_error: unknown, opName: string, msg?: string) => ({
        error: msg || `${opName} failed`,
        status: 500,
      }),
    )
  })

  it('rejects missing productRef with status 400', async () => {
    const result = await getProductCore(new Request('http://localhost/api/get-product'))
    expect(result).toEqual({
      error: 'Missing required parameter: productRef',
      status: 400,
    })
    expect(mockGetProduct).not.toHaveBeenCalled()
  })

  it('returns product on the happy path', async () => {
    const result = await getProductCore(
      new Request('http://localhost/api/get-product?productRef=prd_1'),
      {
        solvaPay: {
          apiClient: { getProduct: mockGetProduct },
        } as never,
      },
    )

    expect(mockGetProduct).toHaveBeenCalledWith('prd_1')
    expect(result).toEqual({
      reference: 'prd_1',
      name: 'API Access',
    })
  })

  it('returns 500 when getProduct is unavailable on the client', async () => {
    const result = await getProductCore(
      new Request('http://localhost/api/get-product?productRef=prd_1'),
      { solvaPay: { apiClient: {} } as never },
    )

    expect(result).toEqual({
      error: 'Get product method not available',
      status: 500,
    })
  })

  it('returns 500 when secret key config is missing and no solvaPay is provided', async () => {
    vi.mocked(core.getSolvaPayConfig).mockReturnValue({ apiKey: '' })

    const result = await getProductCore(
      new Request('http://localhost/api/get-product?productRef=prd_1'),
    )

    expect(result).toEqual({
      error: 'Server configuration error: SolvaPay secret key not configured',
      status: 500,
    })
  })

  it('wraps thrown errors with handleRouteError', async () => {
    mockGetProduct.mockRejectedValue(new Error('Backend exploded'))

    const result = await getProductCore(
      new Request('http://localhost/api/get-product?productRef=prd_1'),
      {
        solvaPay: {
          apiClient: { getProduct: mockGetProduct },
        } as never,
      },
    )

    expect(result).toEqual({
      error: 'Failed to fetch product',
      status: 500,
    })
  })
})
