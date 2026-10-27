import { describe, expect, it } from 'vitest'
import { createSolvaPayAgentClient, parseAuthorizeResponse } from '../client'

describe('parseAuthorizeResponse', () => {
  it('reads each answer authorize gives', () => {
    expect(
      parseAuthorizeResponse({
        status: 'allowed',
        callRef: 'call_A',
        reservation: {
          held: { amount: '0.05', currency: 'USD' },
          expiresAt: '2026-10-26T22:00:00.000Z',
        },
      }),
    ).toMatchObject({ status: 'allowed', callRef: 'call_A' })
    expect(
      parseAuthorizeResponse({
        status: 'refused',
        callRef: 'call_A',
        reason: 'topup_required',
        message: 'Top up to continue.',
      }),
    ).toMatchObject({ reason: 'topup_required' })
    expect(
      parseAuthorizeResponse({
        status: 'waiting',
        callRef: 'call_A',
        message: 'Waiting for your owner.',
        approval: { reference: 'apr_A', expiresAt: '2026-10-26T22:00:00.000Z' },
        retryAfterSeconds: 1,
      }),
    ).toMatchObject({ status: 'waiting', retryAfterSeconds: 1 })
  })

  it('throws on anything it would have to guess at', () => {
    expect(() => parseAuthorizeResponse({ status: 'maybe', callRef: 'call_A' })).toThrow()
    expect(() =>
      parseAuthorizeResponse({
        status: 'refused',
        callRef: 'call_A',
        reason: 'other',
        message: 'x',
      }),
    ).toThrow('reason must be one of')
    expect(() => parseAuthorizeResponse({ status: 'allowed', callRef: 'call_A' })).toThrow()
    expect(() =>
      parseAuthorizeResponse({
        status: 'allowed',
        callRef: 'call_A',
        reservation: { held: { amount: '0.05' }, expiresAt: '2026-10-26T22:00:00.000Z' },
      }),
    ).toThrow('reservation.held.currency')
  })
})

describe('createSolvaPayAgentClient', () => {
  it('posts authorize and complete with the secret key, and lets a held request take its wait', async () => {
    const seen: { url: string; body: unknown }[] = []
    const client = createSolvaPayAgentClient({
      apiBaseUrl: 'https://api.solvapay.test/',
      secretKey: 'sk_sandbox_x',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, body: JSON.parse(init.body as string) })
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk_sandbox_x')
        return new Response(
          url.endsWith('/complete')
            ? JSON.stringify({
                callRef: 'call_A',
                settled: true,
                source: 'reported',
                amount: { amount: '0.01', currency: 'USD' },
                duplicate: false,
              })
            : JSON.stringify({
                status: 'allowed',
                callRef: 'call_A',
                reservation: {
                  held: { amount: '0.05', currency: 'USD' },
                  expiresAt: '2026-10-26T22:00:00.000Z',
                },
              }),
        )
      }) as typeof fetch,
    })
    await client.authorize({
      agentToken: 't',
      requestId: 'r',
      estimate: { amount: '0.05', currency: 'USD' },
      wait: 55,
    })
    await client.complete('call_A', { status: 200, cost: { amount: '0.01', currency: 'USD' } })
    expect(seen.map(s => s.url)).toEqual([
      'https://api.solvapay.test/v1/sdk/agent/calls',
      'https://api.solvapay.test/v1/sdk/agent/calls/call_A/complete',
    ])
  })
})
