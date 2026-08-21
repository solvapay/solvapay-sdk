import { describe, it, expect, vi, beforeEach } from 'vitest'

import * as core from '@solvapay/core'
import * as error from './error'
import { getMerchantCore } from './merchant'

describe('getMerchantCore', () => {
  const mockGetMerchant = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetMerchant.mockReset()
    mockGetMerchant.mockResolvedValue({
      reference: 'mer_1',
      name: 'Acme',
    })
    vi.spyOn(core, 'getSolvaPayConfig').mockReturnValue({ apiKey: 'sk_test' })
    vi.spyOn(error, 'handleRouteError').mockImplementation(
      (_error: unknown, opName: string, msg?: string) => ({
        error: msg || `${opName} failed`,
        status: 500,
      }),
    )
  })

  it('returns merchant on the happy path', async () => {
    const result = await getMerchantCore(new Request('http://localhost/api/merchant'), {
      solvaPay: {
        apiClient: { getMerchant: mockGetMerchant },
      } as never,
    })

    expect(mockGetMerchant).toHaveBeenCalledOnce()
    expect(result).toEqual({
      reference: 'mer_1',
      name: 'Acme',
    })
  })

  it('returns 500 when getMerchant is unavailable on the client', async () => {
    const result = await getMerchantCore(new Request('http://localhost/api/merchant'), {
      solvaPay: { apiClient: {} } as never,
    })

    expect(result).toEqual({
      error: 'Get merchant method not available',
      status: 500,
    })
  })

  it('returns 500 when secret key config is missing and no solvaPay is provided', async () => {
    vi.mocked(core.getSolvaPayConfig).mockReturnValue({ apiKey: '' })

    const result = await getMerchantCore(new Request('http://localhost/api/merchant'))

    expect(result).toEqual({
      error: 'Server configuration error: SolvaPay secret key not configured',
      status: 500,
    })
  })

  it('wraps thrown errors with handleRouteError', async () => {
    mockGetMerchant.mockRejectedValue(new Error('Backend exploded'))

    const result = await getMerchantCore(new Request('http://localhost/api/merchant'), {
      solvaPay: {
        apiClient: { getMerchant: mockGetMerchant },
      } as never,
    })

    expect(result).toEqual({
      error: 'Failed to fetch merchant',
      status: 500,
    })
  })
})
