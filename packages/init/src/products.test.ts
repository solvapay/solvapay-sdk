import { afterEach, describe, expect, it, vi } from 'vitest'
import { listProducts } from './products'

describe('listProducts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed products on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          products: [
            {
              reference: 'prd_abc',
              name: 'API Gateway',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          total: 1,
        }),
      }),
    )

    const result = await listProducts('https://api.solvapay.com', 'sk_test')

    expect(result).toEqual({
      ok: true,
      products: [
        {
          reference: 'prd_abc',
          name: 'API Gateway',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    })
  })

  it('returns parsed products when status is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          products: [
            {
              reference: 'prd_abc',
              name: 'API Gateway',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          total: 1,
        }),
      }),
    )

    const result = await listProducts('https://api.solvapay.com', 'sk_test')

    expect(result).toEqual({
      ok: true,
      products: [
        {
          reference: 'prd_abc',
          name: 'API Gateway',
          status: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    })
  })

  it('returns a warning on HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      }),
    )

    const result = await listProducts('https://api.solvapay.com', 'sk_bad')

    expect(result).toEqual({
      ok: false,
      warning: 'Product listing failed (401): unauthorized',
    })
  })

  it('returns a warning on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('offline')),
    )

    const result = await listProducts('https://api.solvapay.com', 'sk_test')

    expect(result).toEqual({
      ok: false,
      warning: 'Product listing failed due to network error: offline',
    })
  })
})
