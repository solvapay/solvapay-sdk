import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpTransport, DEFAULT_ROUTES } from '../http'

function makeFetch(payload: unknown, status = 200) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        statusText: status === 200 ? 'OK' : 'Bad Gateway',
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

const setupGrant = {
  token: 'vgs-collect-token',
  tenantId: 'tntr4ol0cbq',
  environment: 'sandbox',
  expiresAt: 1_800_000_000_000,
  scope: { sessionId: 'cs_sess_1' },
}

describe('createHttpTransport — card setup (save a card without paying)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('POSTs createCardSetupGrant to /api/create-card-setup-grant with no body and returns the session grant', async () => {
    const fetchFn = makeFetch(setupGrant)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.createCardSetupGrant!()

    expect(DEFAULT_ROUTES.createCardSetupGrant).toBe('/api/create-card-setup-grant')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/create-card-setup-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(result).toStrictEqual(setupGrant)
  })

  it('POSTs saveCard to /api/save-card with the session, card id and returnUrl and returns the outcome', async () => {
    const saved = {
      status: 'requires_action',
      redirectUrl: 'https://acs.bank.test/3ds/setup',
    }
    const fetchFn = makeFetch(saved)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch })

    const result = await transport.saveCard!({
      sessionId: 'cs_sess_1',
      cardId: 'CRD1',
      returnUrl: 'https://app.example/billing?solvapay_card_setup_session=cs_sess_1',
    })

    expect(DEFAULT_ROUTES.saveCard).toBe('/api/save-card')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/save-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'cs_sess_1',
        cardId: 'CRD1',
        returnUrl: 'https://app.example/billing?solvapay_card_setup_session=cs_sess_1',
      }),
    })
    expect(result).toStrictEqual(saved)
  })

  it('honours configured routes for both card setup calls', async () => {
    const fetchFn = makeFetch(setupGrant)
    const transport = createHttpTransport({
      fetch: fetchFn as unknown as typeof fetch,
      api: { createCardSetupGrant: '/billing/setup-grant', saveCard: '/billing/save-card' },
    })

    await transport.createCardSetupGrant!()
    await transport.saveCard!({ sessionId: 'cs_sess_1', cardId: 'CRD1' })

    expect(fetchFn.mock.calls.map(call => call[0])).toStrictEqual([
      '/billing/setup-grant',
      '/billing/save-card',
    ])
  })

  it('rejects with the route error and reports it through onError', async () => {
    const onError = vi.fn()
    const fetchFn = makeFetch({ error: 'Bad Gateway' }, 502)
    const transport = createHttpTransport({ fetch: fetchFn as unknown as typeof fetch, onError })

    await expect(transport.saveCard!({ sessionId: 'cs_sess_1', cardId: 'CRD1' })).rejects.toThrow(
      'Bad Gateway',
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toBe('saveCard')
  })
})
