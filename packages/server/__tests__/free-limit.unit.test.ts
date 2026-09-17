import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay } from '../src'
import type { LimitResponseWithPlan, SolvaPayClient } from '../src/types'

const PREVIEW: LimitResponseWithPlan = {
  withinLimits: true,
  remaining: 5,
  meterName: 'free-previews',
  used: 0,
  limit: 5,
} as LimitResponseWithPlan

const FREE_LIMIT = {
  meter: 'free-previews',
  cap: 5,
  scope: 'rolling_window' as const,
  windowDays: 30,
}

function client(overrides: Partial<SolvaPayClient> = {}): SolvaPayClient {
  return {
    checkLimits: vi.fn().mockResolvedValue(PREVIEW),
    trackUsage: vi.fn().mockResolvedValue({}),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_free' }),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_free' }),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    ...overrides,
  } as unknown as SolvaPayClient
}

describe('freeLimit — decide + trackUsage', () => {
  it('sends freeAllowance and keys the cache on the free meter', async () => {
    const api = client()
    const solvaPay = createSolvaPay({ apiClient: api, limitsCacheTTL: 60_000 })

    await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_free' } },
      { product: 'prd_api', toolName: 'preview_quote', freeLimit: FREE_LIMIT },
    )
    await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_free' } },
      { product: 'prd_api', toolName: 'preview_profile', freeLimit: FREE_LIMIT },
    )

    expect(api.checkLimits).toHaveBeenCalledTimes(1)
    expect(api.checkLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        customerRef: 'cus_free',
        productRef: 'prd_api',
        meterName: 'free-previews',
        freeAllowance: FREE_LIMIT,
        includeCheckoutSession: true,
      }),
    )
  })

  it('does not share a cache entry across different free meters', async () => {
    const api = client()
    const solvaPay = createSolvaPay({ apiClient: api, limitsCacheTTL: 60_000 })

    await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_free' } },
      { product: 'prd_api', freeLimit: FREE_LIMIT },
    )
    await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_free' } },
      {
        product: 'prd_api',
        freeLimit: { ...FREE_LIMIT, meter: 'free-requests' },
      },
    )

    expect(api.checkLimits).toHaveBeenCalledTimes(2)
  })

  it('invalidateLimits still drops the free-meter cache entry', async () => {
    const api = client()
    const solvaPay = createSolvaPay({ apiClient: api, limitsCacheTTL: 60_000 })

    await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_free' } },
      { product: 'prd_api', freeLimit: FREE_LIMIT },
    )
    solvaPay.paywall.invalidateLimits('cus_free', 'prd_api')
    await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_free' } },
      { product: 'prd_api', freeLimit: FREE_LIMIT },
    )

    expect(api.checkLimits).toHaveBeenCalledTimes(2)
  })

  it('throws identity_required for an anonymous free-tool caller', async () => {
    const solvaPay = createSolvaPay({ apiClient: client() })

    await expect(
      solvaPay.paywall.decide({}, { product: 'prd_api', freeLimit: FREE_LIMIT }),
    ).rejects.toMatchObject({
      name: 'SolvaPayError',
      status: 401,
      code: 'identity_required',
    })
  })

  it('stamps usageClass included on paid success with no consequence', async () => {
    const api = client({
      checkLimits: vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 9,
        meterName: 'requests',
      }),
    })
    const solvaPay = createSolvaPay({ apiClient: api })
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const protectedHandler = await solvaPay.payable({ product: 'prd_api' }).function(handler)

    await protectedHandler({ auth: { customer_ref: 'cus_free' } })

    expect(api.trackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        metadata: expect.objectContaining({ usageClass: 'included' }),
      }),
    )
    expect((api.trackUsage as ReturnType<typeof vi.fn>).mock.calls[0][0].metadata).not.toHaveProperty(
      'meterName',
    )
  })

  it('stamps usageClass overage when decide consequence is overage', async () => {
    const api = client({
      checkLimits: vi.fn().mockResolvedValue({
        withinLimits: true,
        remaining: 0,
        overage: true,
        meterName: 'requests',
      }),
    })
    const solvaPay = createSolvaPay({ apiClient: api })
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const protectedHandler = await solvaPay.payable({ product: 'prd_api' }).function(handler)

    await protectedHandler({ auth: { customer_ref: 'cus_free' } })

    expect(api.trackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'success',
        metadata: expect.objectContaining({ usageClass: 'overage' }),
      }),
    )
  })

  it('writes meterName and not usageClass on free success events', async () => {
    const api = client()
    const solvaPay = createSolvaPay({ apiClient: api })
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const protectedHandler = await solvaPay
      .payable({ product: 'prd_api', freeLimit: FREE_LIMIT, toolName: 'preview_quote' })
      .function(handler)

    await protectedHandler({ auth: { customer_ref: 'cus_free' } })

    const meta = (api.trackUsage as ReturnType<typeof vi.fn>).mock.calls[0][0].metadata as Record<
      string,
      unknown
    >
    expect(meta.meterName).toBe('free-previews')
    expect(meta.toolName).toBe('preview_quote')
    expect(meta).not.toHaveProperty('usageClass')
  })
})
