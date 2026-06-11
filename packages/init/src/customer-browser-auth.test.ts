import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCustomerInitSession, waitForCustomerExchange } from './customer-browser-auth'

describe('createCustomerInitSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a customer cli-init session', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'session-1',
        authUrl: 'https://app.solvapay.com/auth/customer/cli-init?session_id=session-1',
        pollToken: 'poll-token',
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await createCustomerInitSession('https://api.solvapay.com', {
      externalRefHint: 'auth0|abc',
    })

    expect(result).toEqual({
      sessionId: 'session-1',
      authUrl: 'https://app.solvapay.com/auth/customer/cli-init?session_id=session-1',
      pollToken: 'poll-token',
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.solvapay.com/v1/ui/customer/auth/cli-init/sessions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ externalRefHint: 'auth0|abc' }),
      },
    )
  })

  it('throws when session creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      }),
    )

    await expect(createCustomerInitSession('https://api.solvapay.com')).rejects.toThrow(
      /Failed to start customer init session \(500\): boom/,
    )
  })
})

describe('waitForCustomerExchange', () => {
  const session = {
    sessionId: 'session-1',
    authUrl: 'https://app.solvapay.com/auth/customer/cli-init?session_id=session-1',
    pollToken: 'poll-token',
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns credential and customerRef when exchange completes', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'pending' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'complete',
          target: 'sdk',
          credential: 'cred_abc',
          customerRef: 'cust_123',
        }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    const promise = waitForCustomerExchange('https://api.solvapay.com', session)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({
      status: 'complete',
      target: 'sdk',
      credential: 'cred_abc',
      customerRef: 'cust_123',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    const init = (fetchSpy.mock.calls[0] ?? [])[1] as { headers?: Record<string, string> } | undefined
    expect(init?.headers?.Authorization).toBe('Bearer poll-token')
  })

  it('returns cancelled when API reports cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'cancelled' }),
      }),
    )

    const promise = waitForCustomerExchange('https://api.solvapay.com', session)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ status: 'cancelled' })
  })

  it('returns expired when timeout elapses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 202 }))

    const promise = waitForCustomerExchange('https://api.solvapay.com', session)
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    const result = await promise

    expect(result).toEqual({ status: 'expired' })
  })

  it('throws when exchange endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'bad exchange',
      }),
    )

    await expect(waitForCustomerExchange('https://api.solvapay.com', session)).rejects.toThrow(
      /Customer init exchange failed \(500\): bad exchange/,
    )
  })

  it('returns consent completion payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'complete',
          target: 'consent',
          consentSid: 'sid_123',
          customerRef: 'cust_123',
        }),
      }),
    )

    const result = await waitForCustomerExchange('https://api.solvapay.com', session)

    expect(result).toEqual({
      status: 'complete',
      target: 'consent',
      consentSid: 'sid_123',
      customerRef: 'cust_123',
    })
  })

  it('throws when consent completion is missing consentSid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'complete',
          target: 'consent',
        }),
      }),
    )

    await expect(waitForCustomerExchange('https://api.solvapay.com', session)).rejects.toThrow(
      /Customer init completed without consent session key/,
    )
  })
})
