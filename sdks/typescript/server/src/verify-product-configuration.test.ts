import { describe, expect, it, vi } from 'vitest'
import { SolvaPayError } from '@solvapay/core'
import { verifyProductConfiguration } from './verify-product-configuration'

describe('verifyProductConfiguration', () => {
  it('returns ready when the product is active with an active plan', async () => {
    const getProduct = vi.fn().mockResolvedValue({
      name: 'Demo',
      status: 'active',
      plans: [{ isActive: true }, { isActive: false }],
    })

    const result = await verifyProductConfiguration({
      apiClient: { getProduct },
      productRef: 'prd_demo',
      apiBaseUrl: 'https://api.solvapay.com',
    })

    expect(getProduct).toHaveBeenCalledWith('prd_demo')
    expect(result).toEqual({
      name: 'Demo',
      status: 'active',
      activePlans: 1,
      totalPlans: 2,
      ready: true,
      issues: [],
    })
  })

  it('returns not-ready when there are no active plans without throwing', async () => {
    const result = await verifyProductConfiguration({
      apiClient: {
        getProduct: vi.fn().mockResolvedValue({
          name: 'Empty',
          status: 'active',
          plans: [],
        }),
      },
      productRef: 'prd_empty',
    })

    expect(result.ready).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('throws an actionable error on 404', async () => {
    await expect(
      verifyProductConfiguration({
        apiClient: {
          getProduct: vi.fn().mockRejectedValue(new SolvaPayError('missing', { status: 404 })),
        },
        productRef: 'prd_missing',
        apiBaseUrl: 'https://api-dev.solvapay.com',
      }),
    ).rejects.toThrow(/does not exist on https:\/\/api-dev\.solvapay\.com/)
  })

  it('throws an unreachable-API error on non-JSON 404 responses', async () => {
    const promise = verifyProductConfiguration({
      apiClient: {
        getProduct: vi
          .fn()
          .mockRejectedValue(
            new SolvaPayError('offline tunnel', { status: 404, code: 'non_json_response' }),
          ),
      },
      productRef: 'prd_demo',
      apiBaseUrl: 'https://api.tommy-local.ngrok.app',
    })

    await expect(promise).rejects.toThrow(/Could not reach https:\/\/api\.tommy-local\.ngrok\.app/)
    await expect(promise).rejects.toThrow(/non-JSON response/)
    await expect(promise).rejects.not.toThrow(/does not exist/)
  })

  it('throws when getProduct is missing', async () => {
    await expect(
      verifyProductConfiguration({
        apiClient: {},
        productRef: 'prd_x',
      }),
    ).rejects.toThrow(/getProduct/)
  })
})
