import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('../src/helpers/customer', () => ({
  syncCustomerCore: vi.fn(),
}))

import { createSolvaPay } from '../src/factory'
import { syncCustomerCore } from '../src/helpers/customer'
import {
  createCardSetupGrantCore,
  parseSaveCardBody,
  saveCardCore,
} from '../src/helpers/card-setup'
import { createSolvaPayClient } from '../src/client'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)
const mockSyncCustomer = vi.mocked(syncCustomerCore)

const grant = {
  token: 'vgs-collect-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox' as const,
  expiresAt: 1_800_000_000_000,
  scope: { sessionId: 'cs_sess_1' },
}

const savedCard = {
  status: 'succeeded' as const,
  paymentMethod: { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
}

function request() {
  return new Request('http://localhost/api/card-setup', { method: 'POST' })
}

describe('createCardSetupGrantCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
  })

  it('opens a customer session for the authenticated customer and returns a grant on it', async () => {
    const solvaPay = {
      createCustomerSession: vi
        .fn()
        .mockResolvedValue({ sessionId: 'cs_sess_1', customerUrl: 'https://x/c' }),
      createCustomerSessionCaptureGrant: vi.fn().mockResolvedValue(grant),
    }
    mockCreateSolvaPay.mockReturnValue(solvaPay as never)

    const req = request()
    const result = await createCardSetupGrantCore(req)

    expect(result).toStrictEqual(grant)
    expect(mockSyncCustomer).toHaveBeenCalledWith(req, { solvaPay: undefined })
    expect(solvaPay.createCustomerSession).toHaveBeenCalledTimes(1)
    expect(solvaPay.createCustomerSession).toHaveBeenCalledWith({ customerRef: 'cus_ABC' })
    expect(solvaPay.createCustomerSessionCaptureGrant).toHaveBeenCalledTimes(1)
    expect(solvaPay.createCustomerSessionCaptureGrant).toHaveBeenCalledWith({
      sessionId: 'cs_sess_1',
    })
  })

  it('returns the auth error without opening a session', async () => {
    mockSyncCustomer.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    const solvaPay = { createCustomerSession: vi.fn(), createCustomerSessionCaptureGrant: vi.fn() }

    const result = await createCardSetupGrantCore(request(), { solvaPay: solvaPay as never })

    expect(result).toStrictEqual({ error: 'Unauthorized', status: 401 })
    expect(solvaPay.createCustomerSession).not.toHaveBeenCalled()
    expect(solvaPay.createCustomerSessionCaptureGrant).not.toHaveBeenCalled()
  })

  it('maps a backend failure to a route error', async () => {
    const solvaPay = {
      createCustomerSession: vi
        .fn()
        .mockResolvedValue({ sessionId: 'cs_sess_1', customerUrl: 'https://x/c' }),
      createCustomerSessionCaptureGrant: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createCardSetupGrantCore(request(), { solvaPay: solvaPay as never })

    expect(result).toMatchObject({ status: 500 })
    expect((result as { error: string }).error).toMatch(/card setup/i)
    spy.mockRestore()
  })
})

describe('parseSaveCardBody', () => {
  it('accepts the captured card with its return URL and keeps billing details', () => {
    expect(
      parseSaveCardBody({
        sessionId: 'cs_sess_1',
        cardId: 'CRD1',
        returnUrl: 'https://app.example/r',
        billingDetails: { name: 'Ada' },
        extra: 'dropped',
      }),
    ).toStrictEqual({
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/r',
      billingDetails: { name: 'Ada' },
    })
  })

  it('accepts the completion of a pending setup', () => {
    expect(parseSaveCardBody({ sessionId: 'cs_sess_1', completePendingSetup: true })).toStrictEqual(
      { sessionId: 'cs_sess_1', completePendingSetup: true },
    )
  })

  it('refuses a body with neither or both shapes, a missing return URL, or a false flag', () => {
    expect(parseSaveCardBody({ sessionId: 'cs_sess_1' })).toStrictEqual({
      error: 'Provide exactly one of cardId or completePendingSetup',
      status: 400,
    })
    expect(
      parseSaveCardBody({ sessionId: 'cs_sess_1', cardId: 'CRD1', completePendingSetup: true }),
    ).toStrictEqual({ error: 'Provide exactly one of cardId or completePendingSetup', status: 400 })
    expect(parseSaveCardBody({ sessionId: 'cs_sess_1', cardId: 'CRD1' })).toStrictEqual({
      error: 'returnUrl is required',
      status: 400,
    })
    expect(
      parseSaveCardBody({ sessionId: 'cs_sess_1', cardId: 'CRD1', returnUrl: '' }),
    ).toStrictEqual({ error: 'returnUrl is required', status: 400 })
    expect(parseSaveCardBody({ sessionId: 'cs_sess_1', cardId: '' })).toStrictEqual({
      error: 'cardId is required',
      status: 400,
    })
    expect(
      parseSaveCardBody({ sessionId: 'cs_sess_1', completePendingSetup: false }),
    ).toStrictEqual({ error: 'completePendingSetup must be true', status: 400 })
    expect(parseSaveCardBody({ cardId: 'CRD1', returnUrl: 'https://app.example/r' })).toStrictEqual(
      {
        error: 'sessionId is required',
        status: 400,
      },
    )
    expect(parseSaveCardBody(undefined)).toStrictEqual({
      error: 'sessionId is required',
      status: 400,
    })
  })
})

describe('saveCardCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
  })

  function solvaPayFor(ownerRef: string) {
    return {
      getCustomerSession: vi.fn().mockResolvedValue({
        sessionId: 'cs_sess_1',
        status: 'active',
        customer: { reference: ownerRef },
      }),
      saveCustomerSessionCard: vi.fn().mockResolvedValue(savedCard),
    }
  }

  it('saves the captured card on the caller’s own session with its return URL and billing details', async () => {
    const solvaPay = solvaPayFor('cus_ABC')

    const result = await saveCardCore(
      request(),
      {
        sessionId: 'cs_sess_1',
        cardId: 'CRD1',
        returnUrl: 'https://app.example/r',
        billingDetails: { name: 'Ada Lovelace', address: { country: 'SE', postalCode: '11122' } },
      },
      { solvaPay: solvaPay as never },
    )

    expect(result).toStrictEqual(savedCard)
    expect(solvaPay.getCustomerSession).toHaveBeenCalledWith({ sessionId: 'cs_sess_1' })
    expect(solvaPay.saveCustomerSessionCard).toHaveBeenCalledTimes(1)
    expect(solvaPay.saveCustomerSessionCard).toHaveBeenCalledWith({
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/r',
      billingDetails: { name: 'Ada Lovelace', address: { country: 'SE', postalCode: '11122' } },
    })
  })

  it('passes a requires_action outcome through', async () => {
    const solvaPay = solvaPayFor('cus_ABC')
    solvaPay.saveCustomerSessionCard.mockResolvedValue({
      status: 'requires_action',
      redirectUrl: 'https://acs.bank.test/3ds/setup',
    })

    const result = await saveCardCore(
      request(),
      { sessionId: 'cs_sess_1', cardId: 'CRD1', returnUrl: 'https://app.example/r' },
      { solvaPay: solvaPay as never },
    )

    expect(result).toStrictEqual({
      status: 'requires_action',
      redirectUrl: 'https://acs.bank.test/3ds/setup',
    })
  })

  it('completes a pending setup on the caller’s own session', async () => {
    const solvaPay = solvaPayFor('cus_ABC')

    const result = await saveCardCore(
      request(),
      { sessionId: 'cs_sess_1', completePendingSetup: true },
      { solvaPay: solvaPay as never },
    )

    expect(result).toStrictEqual(savedCard)
    expect(solvaPay.saveCustomerSessionCard).toHaveBeenCalledWith({
      sessionId: 'cs_sess_1',
      completePendingSetup: true,
    })
  })

  it('passes a processing outcome through', async () => {
    const solvaPay = solvaPayFor('cus_ABC')
    solvaPay.saveCustomerSessionCard.mockResolvedValue({ status: 'processing' })
    const result = await saveCardCore(
      request(),
      { sessionId: 'cs_sess_1', cardId: 'CRD1', returnUrl: 'https://app.example/r' },
      { solvaPay: solvaPay as never },
    )
    expect(result).toStrictEqual({ status: 'processing' })
  })

  it('omits billingDetails when none are given', async () => {
    const solvaPay = solvaPayFor('cus_ABC')
    await saveCardCore(
      request(),
      { sessionId: 'cs_sess_1', cardId: 'CRD1', returnUrl: 'https://app.example/r' },
      { solvaPay: solvaPay as never },
    )
    expect(solvaPay.saveCustomerSessionCard).toHaveBeenCalledWith({
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/r',
    })
  })

  it('refuses a session that belongs to another customer, for a card and for a completion', async () => {
    const solvaPay = solvaPayFor('cus_OTHER')

    expect(
      await saveCardCore(
        request(),
        { sessionId: 'cs_sess_1', cardId: 'CRD1', returnUrl: 'https://app.example/r' },
        { solvaPay: solvaPay as never },
      ),
    ).toStrictEqual({ error: 'Customer session not found', status: 404 })
    expect(
      await saveCardCore(
        request(),
        { sessionId: 'cs_sess_1', completePendingSetup: true },
        { solvaPay: solvaPay as never },
      ),
    ).toStrictEqual({ error: 'Customer session not found', status: 404 })
    expect(solvaPay.saveCustomerSessionCard).not.toHaveBeenCalled()
  })

  it('answers a malformed body with 400 before any backend call', async () => {
    const solvaPay = solvaPayFor('cus_ABC')

    expect(
      await saveCardCore(
        request(),
        { sessionId: '', cardId: 'CRD1' },
        { solvaPay: solvaPay as never },
      ),
    ).toStrictEqual({ error: 'sessionId is required', status: 400 })
    expect(
      await saveCardCore(
        request(),
        { sessionId: 'cs_sess_1', cardId: 'CRD1' },
        { solvaPay: solvaPay as never },
      ),
    ).toStrictEqual({ error: 'returnUrl is required', status: 400 })
    expect(
      await saveCardCore(request(), { sessionId: 'cs_sess_1' }, { solvaPay: solvaPay as never }),
    ).toStrictEqual({ error: 'Provide exactly one of cardId or completePendingSetup', status: 400 })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
    expect(solvaPay.getCustomerSession).not.toHaveBeenCalled()
  })
})

describe('createSolvaPayClient — card setup routes', () => {
  const baseUrl = 'https://api.solvapay.com'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the capture grant to /v1/customer-sessions/:sessionId/capture-grant', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
    const client = createSolvaPayClient({ apiKey: 'sk_test_123', apiBaseUrl: baseUrl })

    const result = await client.createCustomerSessionCaptureGrant!({ sessionId: 'cs sess/1' })

    expect(result).toStrictEqual(grant)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${baseUrl}/v1/customer-sessions/cs%20sess%2F1/capture-grant`)
    expect(init!.method).toBe('POST')
    expect(init!.body).toBeUndefined()
  })

  it('POSTs the card to /v1/customer-sessions/:sessionId/payment-methods', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(savedCard), { status: 200 }))
    const client = createSolvaPayClient({ apiKey: 'sk_test_123', apiBaseUrl: baseUrl })

    const result = await client.saveCustomerSessionCard!({
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      billingDetails: { name: 'Ada Lovelace' },
      returnUrl: 'https://app.example/r',
    })

    expect(result).toStrictEqual(savedCard)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${baseUrl}/v1/customer-sessions/cs_sess_1/payment-methods`)
    expect(init!.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toStrictEqual({
      cardId: 'CRD1',
      billingDetails: { name: 'Ada Lovelace' },
      returnUrl: 'https://app.example/r',
    })
  })

  it('POSTs the completion of a pending setup to /v1/customer-sessions/:sessionId/payment-methods', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(savedCard), { status: 200 }))
    const client = createSolvaPayClient({ apiKey: 'sk_test_123', apiBaseUrl: baseUrl })

    const result = await client.saveCustomerSessionCard!({
      sessionId: 'cs_sess_1',
      completePendingSetup: true,
    })

    expect(result).toStrictEqual(savedCard)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${baseUrl}/v1/customer-sessions/cs_sess_1/payment-methods`)
    expect(JSON.parse(init!.body as string)).toStrictEqual({ completePendingSetup: true })
  })

  it('GETs the customer session for the owner check', async () => {
    const session = { sessionId: 'cs_sess_1', status: 'active', customer: { reference: 'cus_ABC' } }
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
    const client = createSolvaPayClient({ apiKey: 'sk_test_123', apiBaseUrl: baseUrl })

    const result = await client.getCustomerSession!({ sessionId: 'cs_sess_1' })

    expect(result).toStrictEqual(session)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${baseUrl}/v1/sdk/customers/customer-sessions/cs_sess_1`)
    expect(init!.method).toBe('GET')
  })
})
