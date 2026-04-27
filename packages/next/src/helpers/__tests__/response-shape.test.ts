import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@solvapay/server', () => ({
  getMerchantCore: vi.fn(),
  getPaymentMethodCore: vi.fn(),
  cancelPurchaseCore: vi.fn(),
  getAuthenticatedUserCore: vi.fn(),
  isErrorResult: vi.fn(
    (r: unknown) =>
      typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
}))

import {
  getMerchantCore,
  getPaymentMethodCore,
  cancelPurchaseCore,
} from '@solvapay/server'
import { toNextRouteResponse } from '../_response'
import { getMerchant } from '../merchant'
import { getPaymentMethod } from '../payment-method'
import { cancelRenewal } from '../renewal'

const mockGetMerchantCore = vi.mocked(getMerchantCore)
const mockGetPaymentMethodCore = vi.mocked(getPaymentMethodCore)
const mockCancelPurchaseCore = vi.mocked(cancelPurchaseCore)

function fakeRequest(url = 'http://localhost/api', init?: RequestInit) {
  return new Request(url, init)
}

describe('toNextRouteResponse', () => {
  it('wraps success payload in NextResponse.json with 200 status', async () => {
    const response = toNextRouteResponse({ hello: 'world' })

    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hello: 'world' })
  })

  it('preserves ErrorResult status code', async () => {
    const response = toNextRouteResponse({
      error: 'Unauthorized',
      details: 'No token',
      status: 401,
    })

    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      details: 'No token',
    })
  })

  it('omits extra fields on the error envelope (only error + details are forwarded)', async () => {
    const response = toNextRouteResponse({
      error: 'Not found',
      status: 404,
      details: { resource: 'customer' },
      secret: 'should-not-appear',
    } as unknown as { error: string; status: number; details: unknown })

    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({ error: 'Not found', details: { resource: 'customer' } })
    expect(body.secret).toBeUndefined()
  })
})

describe('getMerchant (route-wrapper smoke test)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a NextResponse containing the core payload on success', async () => {
    mockGetMerchantCore.mockResolvedValue({
      legalName: 'Acme Inc.',
      supportEmail: 'support@acme.test',
    })

    const response = await getMerchant(fakeRequest())

    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      legalName: 'Acme Inc.',
      supportEmail: 'support@acme.test',
    })
  })

  it('returns a NextResponse error on core failure', async () => {
    mockGetMerchantCore.mockResolvedValue({
      error: 'Unauthorized',
      details: 'No token',
      status: 401,
    })

    const response = await getMerchant(fakeRequest())

    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      details: 'No token',
    })
  })
})

describe('getPaymentMethod (route-wrapper smoke test)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps the `none` case in a NextResponse with 200', async () => {
    mockGetPaymentMethodCore.mockResolvedValue({ kind: 'none' })

    const response = await getPaymentMethod(fakeRequest())

    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: 'none' })
  })

  it('wraps the card case in a NextResponse with 200', async () => {
    mockGetPaymentMethodCore.mockResolvedValue({
      kind: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2029,
    })

    const response = await getPaymentMethod(fakeRequest())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      kind: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2029,
    })
  })

  it('surfaces core errors with the correct status', async () => {
    mockGetPaymentMethodCore.mockResolvedValue({
      error: 'Not found',
      details: 'customer missing',
      status: 404,
    })

    const response = await getPaymentMethod(fakeRequest())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: 'Not found',
      details: 'customer missing',
    })
  })
})

describe('cancelRenewal (route-wrapper with side-effect)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a NextResponse with the cancelled purchase on success', async () => {
    mockCancelPurchaseCore.mockResolvedValue({
      purchaseRef: 'pur_123',
      cancelledAt: '2026-04-20T12:00:00Z',
    })

    const response = await cancelRenewal(
      fakeRequest('http://localhost/api/cancel-renewal', { method: 'POST' }),
      { purchaseRef: 'pur_123' },
    )

    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      purchaseRef: 'pur_123',
      cancelledAt: '2026-04-20T12:00:00Z',
    })
  })

  it('returns a NextResponse error without attempting cache clearing', async () => {
    mockCancelPurchaseCore.mockResolvedValue({
      error: 'Purchase not found',
      status: 404,
    })

    const response = await cancelRenewal(
      fakeRequest('http://localhost/api/cancel-renewal', { method: 'POST' }),
      { purchaseRef: 'missing' },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Purchase not found' })
  })
})
