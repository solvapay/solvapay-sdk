import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@solvapay/server', () => ({
  createCardSetupGrantCore: vi.fn(),
  saveCardCore: vi.fn(),
  isErrorResult: vi.fn(
    (r: unknown) => typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
}))

import { createCardSetupGrantCore, saveCardCore } from '@solvapay/server'
import { createCardSetupGrant, saveCard } from './payment'

const mockCreateCardSetupGrantCore = vi.mocked(createCardSetupGrantCore)
const mockSaveCardCore = vi.mocked(saveCardCore)

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
  scope: { sessionId: 'cs_sess_1' },
}

describe('createCardSetupGrant (Next route wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the request and options and returns the session grant as JSON 200', async () => {
    mockCreateCardSetupGrantCore.mockResolvedValue(grant)
    const request = fakeRequest('/api/create-card-setup-grant')
    const solvaPay = { createCustomerSessionCaptureGrant: vi.fn() }

    const response = await createCardSetupGrant(request, { solvaPay: solvaPay as never })

    expect(mockCreateCardSetupGrantCore).toHaveBeenCalledTimes(1)
    expect(mockCreateCardSetupGrantCore).toHaveBeenCalledWith(request, { solvaPay })
    expect(response).toBeInstanceOf(NextResponse)
    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(grant)
  })

  it('maps a core ErrorResult to a JSON error envelope with the same status', async () => {
    mockCreateCardSetupGrantCore.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    const response = await createCardSetupGrant(fakeRequest('/api/create-card-setup-grant'))
    expect(mockCreateCardSetupGrantCore).toHaveBeenCalledWith(expect.any(Request), {})
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'Unauthorized' })
  })
})

describe('saveCard (Next route wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards session, card, billing details and returnUrl and returns the outcome', async () => {
    const saved = { status: 'requires_action' as const, redirectUrl: 'https://acs.bank.test/3ds/setup' }
    mockSaveCardCore.mockResolvedValue(saved)
    const request = fakeRequest('/api/save-card')
    const body = {
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      billingDetails: { name: 'Ada' },
      returnUrl: 'https://app.example/r',
    }

    const response = await saveCard(request, body)

    expect(mockSaveCardCore).toHaveBeenCalledTimes(1)
    expect(mockSaveCardCore).toHaveBeenCalledWith(request, body, {})
    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual(saved)
  })

  it('passes a 404 for another customer’s session through unchanged', async () => {
    mockSaveCardCore.mockResolvedValue({ error: 'Customer session not found', status: 404 })
    const response = await saveCard(fakeRequest('/api/save-card'), {
      sessionId: 'cs_other',
      cardId: 'CRD1',
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'Customer session not found' })
  })
})
