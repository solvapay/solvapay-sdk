import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@solvapay/server', () => ({
  checkPurchaseCore: vi.fn(),
  trackUsageCore: vi.fn(),
  createPaymentIntentCore: vi.fn(),
  processPaymentIntentCore: vi.fn(),
  createTopupPaymentIntentCore: vi.fn(),
  getCustomerBalanceCore: vi.fn(),
  cancelPurchaseCore: vi.fn(),
  reactivatePurchaseCore: vi.fn(),
  activatePlanCore: vi.fn(),
  listPlansCore: vi.fn(),
  isErrorResult: vi.fn(
    (r: unknown) => typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
}))

import {
  checkPurchaseCore,
  trackUsageCore,
  createPaymentIntentCore,
  processPaymentIntentCore,
  createTopupPaymentIntentCore,
  getCustomerBalanceCore,
  cancelPurchaseCore,
  reactivatePurchaseCore,
  activatePlanCore,
  listPlansCore,
} from '@solvapay/server'
import {
  checkPurchase,
  trackUsage,
  createPaymentIntent,
  processPayment,
  createTopupPaymentIntent,
  customerBalance,
  cancelRenewal,
  reactivateRenewal,
  activatePlan,
  listPlans,
} from './handlers'
import { configureCors } from './cors'

const mockCheckPurchaseCore = vi.mocked(checkPurchaseCore)
const mockTrackUsageCore = vi.mocked(trackUsageCore)
const mockCreatePaymentIntentCore = vi.mocked(createPaymentIntentCore)
const mockProcessPaymentIntentCore = vi.mocked(processPaymentIntentCore)
const mockCreateTopupPaymentIntentCore = vi.mocked(createTopupPaymentIntentCore)
const mockGetCustomerBalanceCore = vi.mocked(getCustomerBalanceCore)
const mockCancelPurchaseCore = vi.mocked(cancelPurchaseCore)
const mockReactivatePurchaseCore = vi.mocked(reactivatePurchaseCore)
const mockActivatePlanCore = vi.mocked(activatePlanCore)
const mockListPlansCore = vi.mocked(listPlansCore)

function fakeGet(url = 'http://localhost/api/test') {
  return new Request(url, { method: 'GET' })
}

function fakePost(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function fakeOptions() {
  return new Request('http://localhost/api/test', { method: 'OPTIONS' })
}

beforeEach(() => {
  vi.clearAllMocks()
  configureCors({ origins: ['*'] })
})

describe('checkPurchase', () => {
  it('returns CORS preflight for OPTIONS', async () => {
    const res = await checkPurchase(fakeOptions())
    expect(res.status).toBe(204)
  })

  it('returns success JSON with CORS headers', async () => {
    mockCheckPurchaseCore.mockResolvedValue({
      customerRef: 'cus_1',
      purchases: [],
    })

    const res = await checkPurchase(fakeGet())
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual({ customerRef: 'cus_1', purchases: [] })
  })

  it('returns error response when core returns error', async () => {
    mockCheckPurchaseCore.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
    })

    const res = await checkPurchase(fakeGet())
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })
})

describe('trackUsage', () => {
  it('returns CORS preflight for OPTIONS', async () => {
    const res = await trackUsage(fakeOptions())
    expect(res.status).toBe(204)
  })

  it('parses body and calls core helper', async () => {
    mockTrackUsageCore.mockResolvedValue({ success: true })

    const res = await trackUsage(fakePost({ units: 5, actionType: 'api_call' }))
    expect(res.status).toBe(200)
    expect(mockTrackUsageCore).toHaveBeenCalledWith(
      expect.any(Request),
      { units: 5, actionType: 'api_call' },
      {},
    )
  })
})

describe('createPaymentIntent', () => {
  it('returns CORS preflight for OPTIONS', async () => {
    const res = await createPaymentIntent(fakeOptions())
    expect(res.status).toBe(204)
  })

  it('parses body and returns payment intent', async () => {
    mockCreatePaymentIntentCore.mockResolvedValue({
      processorPaymentId: 'pi_1',
      clientSecret: 'cs_1',
      publishableKey: 'pk_1',
      customerRef: 'cus_1',
    })

    const res = await createPaymentIntent(
      fakePost({ planRef: 'pln_1', productRef: 'prd_1' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ clientSecret: 'cs_1' })
  })
})

describe('processPayment', () => {
  it('returns CORS preflight for OPTIONS', async () => {
    const res = await processPayment(fakeOptions())
    expect(res.status).toBe(204)
  })

  it('parses body and returns processed result', async () => {
    mockProcessPaymentIntentCore.mockResolvedValue({
      type: 'recurring',
      status: 'completed',
    })

    const res = await processPayment(
      fakePost({ paymentIntentId: 'pi_1', productRef: 'prd_1' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'completed' })
  })
})

describe('createTopupPaymentIntent', () => {
  it('parses body and returns topup intent', async () => {
    mockCreateTopupPaymentIntentCore.mockResolvedValue({
      processorPaymentId: 'pi_1',
      clientSecret: 'cs_1',
      publishableKey: 'pk_1',
      customerRef: 'cus_1',
    })

    const res = await createTopupPaymentIntent(
      fakePost({ amount: 1000, currency: 'USD' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ clientSecret: 'cs_1' })
  })
})

describe('customerBalance', () => {
  it('returns balance for authenticated user', async () => {
    mockGetCustomerBalanceCore.mockResolvedValue({
      customerRef: 'cus_1',
      credits: 500,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 1,
      displayExchangeRate: 1,
    })

    const res = await customerBalance(fakeGet())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ credits: 500 })
  })
})

describe('cancelRenewal', () => {
  it('parses body and returns cancelled purchase', async () => {
    mockCancelPurchaseCore.mockResolvedValue({
      reference: 'pur_1',
      status: 'cancelled',
    })

    const res = await cancelRenewal(fakePost({ purchaseRef: 'pur_1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ reference: 'pur_1' })
  })
})

describe('reactivateRenewal', () => {
  it('parses body and returns reactivated purchase', async () => {
    mockReactivatePurchaseCore.mockResolvedValue({
      reference: 'pur_1',
      status: 'active',
    })

    const res = await reactivateRenewal(fakePost({ purchaseRef: 'pur_1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ reference: 'pur_1' })
  })
})

describe('activatePlan', () => {
  it('parses body and returns activation result', async () => {
    mockActivatePlanCore.mockResolvedValue({
      purchase: { reference: 'pur_1' },
    } as never)

    const res = await activatePlan(
      fakePost({ productRef: 'prd_1', planRef: 'pln_1' }),
    )
    expect(res.status).toBe(200)
  })
})

describe('listPlans', () => {
  it('passes through query params and returns plans', async () => {
    mockListPlansCore.mockResolvedValue({
      plans: [{ reference: 'pln_1' }] as never,
      productRef: 'prd_1',
    })

    const res = await listPlans(fakeGet('http://localhost/api/plans?productRef=prd_1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ plans: [{ reference: 'pln_1' }] })
  })
})
