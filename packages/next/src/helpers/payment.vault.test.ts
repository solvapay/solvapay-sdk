import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@solvapay/server', () => ({
  createCaptureGrantCore: vi.fn(),
  confirmPaymentCore: vi.fn(),
  isErrorResult: vi.fn(
    (r: unknown) => typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
}))

import { createCaptureGrantCore, confirmPaymentCore } from '@solvapay/server'
import { createCaptureGrant, confirmPayment } from './payment'

const mockCreateCaptureGrantCore = vi.mocked(createCaptureGrantCore)
const mockConfirmPaymentCore = vi.mocked(confirmPaymentCore)

function fakeRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

const grant = {
  token: 'vgs-collect-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox' as const,
  expiresAt: 1_800_000_000_000,
  scope: { paymentIntentId: 'pi_1' },
}

describe('createCaptureGrant (Next route wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards request, body and options to createCaptureGrantCore and returns the grant as JSON 200', async () => {
    mockCreateCaptureGrantCore.mockResolvedValue(grant)
    const request = fakeRequest('/api/create-capture-grant')
    const solvaPay = { createCaptureGrant: vi.fn() }

    const response = await createCaptureGrant(request, { paymentIntentId: 'pi_1' }, { solvaPay: solvaPay as never })

    expect(mockCreateCaptureGrantCore).toHaveBeenCalledTimes(1)
    expect(mockCreateCaptureGrantCore).toHaveBeenCalledWith(request, { paymentIntentId: 'pi_1' }, { solvaPay })
    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toStrictEqual(grant)
  })

  it('defaults options to an empty object when none are given', async () => {
    mockCreateCaptureGrantCore.mockResolvedValue(grant)
    const request = fakeRequest('/api/create-capture-grant')
    await createCaptureGrant(request, { paymentIntentId: 'pi_1' })
    expect(mockCreateCaptureGrantCore).toHaveBeenCalledWith(request, { paymentIntentId: 'pi_1' }, {})
  })

  it('maps a core ErrorResult to a JSON error envelope with the same status', async () => {
    mockCreateCaptureGrantCore.mockResolvedValue({
      error: 'paymentIntentId is required',
      status: 400,
    })

    const response = await createCaptureGrant(fakeRequest('/api/create-capture-grant'), { paymentIntentId: '' })

    expect(response.status).toBe(400)
    expect(await response.json()).toStrictEqual({ error: 'paymentIntentId is required' })
  })

  it('forwards details on a 500 from the core helper', async () => {
    mockCreateCaptureGrantCore.mockResolvedValue({
      error: 'Could not start card capture',
      status: 500,
      details: 'grant limit reached',
    })

    const response = await createCaptureGrant(fakeRequest('/api/create-capture-grant'), { paymentIntentId: 'pi_1' })

    expect(response.status).toBe(500)
    expect(await response.json()).toStrictEqual({
      error: 'Could not start card capture',
      details: 'grant limit reached',
    })
  })
})

describe('confirmPayment (Next route wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the card confirm body verbatim and returns the confirmed payment as JSON 200', async () => {
    const payment = { id: 'pi_1', processorPaymentId: 'pi_rail_1', status: 'succeeded' as const }
    mockConfirmPaymentCore.mockResolvedValue(payment)
    const request = fakeRequest('/api/confirm-payment')
    const body = { paymentIntentId: 'pi_1', cardId: 'CRD1', returnUrl: 'https://app.example/return' }

    const response = await confirmPayment(request, body)

    expect(mockConfirmPaymentCore).toHaveBeenCalledTimes(1)
    expect(mockConfirmPaymentCore).toHaveBeenCalledWith(request, body, {})
    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(payment)
  })

  it('forwards a saved-payment-method body and the solvaPay option, returning a 3DS redirect untouched', async () => {
    const payment = {
      id: 'pi_1',
      processorPaymentId: 'pi_rail_1',
      status: 'requires_action' as const,
      redirectUrl: 'https://acs.bank.test/3ds/abc',
    }
    mockConfirmPaymentCore.mockResolvedValue(payment)
    const request = fakeRequest('/api/confirm-payment')
    const solvaPay = { confirmPayment: vi.fn() }
    const body = { paymentIntentId: 'pi_1', paymentMethodId: 'pm_saved' }

    const response = await confirmPayment(request, body, { solvaPay: solvaPay as never })

    expect(mockConfirmPaymentCore).toHaveBeenCalledWith(request, body, { solvaPay })
    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(payment)
  })

  it('maps a 400 validation error from the core helper', async () => {
    mockConfirmPaymentCore.mockResolvedValue({
      error: 'Provide cardId or paymentMethodId',
      status: 400,
    })

    const response = await confirmPayment(fakeRequest('/api/confirm-payment'), { paymentIntentId: 'pi_1' })

    expect(response.status).toBe(400)
    expect(await response.json()).toStrictEqual({ error: 'Provide cardId or paymentMethodId' })
  })

  it('maps an auth error from the core helper to 401', async () => {
    mockConfirmPaymentCore.mockResolvedValue({ error: 'Unauthorized', status: 401, details: 'No token' })

    const response = await confirmPayment(fakeRequest('/api/confirm-payment'), { paymentIntentId: 'pi_1', cardId: 'CRD1' })

    expect(response.status).toBe(401)
    expect(await response.json()).toStrictEqual({ error: 'Unauthorized', details: 'No token' })
  })

  it('maps a 500 from the core helper with its details', async () => {
    mockConfirmPaymentCore.mockResolvedValue({
      error: 'Payment confirmation failed',
      status: 500,
      details: 'rail down',
    })

    const response = await confirmPayment(fakeRequest('/api/confirm-payment'), { paymentIntentId: 'pi_1', cardId: 'CRD1' })

    expect(response.status).toBe(500)
    expect(await response.json()).toStrictEqual({ error: 'Payment confirmation failed', details: 'rail down' })
  })
})
