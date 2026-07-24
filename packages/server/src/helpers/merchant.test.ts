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
import { getMerchantCore } from './merchant'

const mockGetConfig = vi.mocked(getSolvaPayConfig)

describe('getMerchantCore', () => {
  const mockGetMerchant = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMerchant.mockResolvedValue({
      reference: 'mer_1',
      name: 'Acme',
    })
    mockGetConfig.mockReturnValue({ apiKey: 'sk_test' })
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
    mockGetConfig.mockReturnValue({ apiKey: '' })

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
