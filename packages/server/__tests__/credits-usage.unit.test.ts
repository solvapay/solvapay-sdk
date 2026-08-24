import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSolvaPay, createSolvaPayClient } from '../src'

const apiKey = 'sk_test_123'
const apiBaseUrl = 'https://api.test.solvapay.com'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getFetchCall(index = 0): [string, RequestInit] {
  const fetchMock = vi.mocked(fetch)
  const call = fetchMock.mock.calls[index]
  if (!call) throw new Error(`Missing fetch call ${index}`)

  return [String(call[0]), call[1] as RequestInit]
}

describe('credits and usage client methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('assignCredits posts grants with an idempotency key and returns the backend response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        customerRef: 'cus_123',
        credits: 25000,
        balance: 50000,
        reason: 'signup_bonus',
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl })
    const result = await client.assignCredits({
      customerRef: 'cus_123',
      credits: 25000,
      reason: 'signup_bonus',
      idempotencyKey: 'grant_signup_cus_123',
    })

    const [url, init] = getFetchCall()
    expect(url).toBe(`${apiBaseUrl}/v1/sdk/customers/cus_123/credits`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': 'grant_signup_cus_123',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      credits: 25000,
      reason: 'signup_bonus',
    })
    expect(result).toEqual({
      success: true,
      customerRef: 'cus_123',
      credits: 25000,
      balance: 50000,
      reason: 'signup_bonus',
    })
  })

  it('trackUsage returns the backend usage and credit debit response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        reference: 'usage_123',
        creditDebit: {
          debited: true,
          amount: 20,
          unitsRemaining: 9,
        },
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl })
    const result = await client.trackUsage({
      customerRef: 'cus_123',
      productRef: 'prd_123',
      actionType: 'api_call',
      units: 2,
      outcome: 'success',
      idempotencyKey: 'usage_key_123',
    })

    const [url, init] = getFetchCall()
    expect(url).toBe(`${apiBaseUrl}/v1/sdk/usages`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      customerRef: 'cus_123',
      productRef: 'prd_123',
      idempotencyKey: 'usage_key_123',
    })
    expect(result).toEqual({
      success: true,
      reference: 'usage_123',
      creditDebit: {
        debited: true,
        amount: 20,
        unitsRemaining: 9,
      },
    })
  })

  it('trackUsageBulk posts bulk usage events and returns per-event debit results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        inserted: 2,
        results: [
          { reference: 'usage_1', creditDebit: { debited: true, amount: 10 } },
          { reference: 'usage_2', creditDebit: { debited: false, reason: 'duplicate' } },
        ],
      }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl })
    const result = await client.trackUsageBulk({
      events: [
        { customerRef: 'cus_123', productRef: 'prd_123', units: 1 },
        { customerRef: 'cus_123', productRef: 'prd_123', units: 1 },
      ],
    })

    const [url, init] = getFetchCall()
    expect(url).toBe(`${apiBaseUrl}/v1/sdk/usages/bulk`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      events: [
        { customerRef: 'cus_123', productRef: 'prd_123', units: 1 },
        { customerRef: 'cus_123', productRef: 'prd_123', units: 1 },
      ],
    })
    expect(result.results).toHaveLength(2)
    expect(result.results[1]?.creditDebit).toEqual({ debited: false, reason: 'duplicate' })
  })

  it('createSolvaPay exposes assignCredits and trackUsageBulk by delegating to the API client', async () => {
    const assignCredits = vi.fn().mockResolvedValue({
      success: true,
      customerRef: 'cus_123',
      credits: 25000,
      balance: 50000,
    })
    const trackUsageBulk = vi.fn().mockResolvedValue({
      success: true,
      inserted: 1,
      results: [{ reference: 'usage_1' }],
    })

    const sdk = createSolvaPay({
      apiClient: {
        checkLimits: vi.fn(),
        trackUsage: vi.fn(),
        assignCredits,
        trackUsageBulk,
      },
    })

    await sdk.assignCredits({ customerRef: 'cus_123', credits: 25000 })
    await sdk.trackUsageBulk({ events: [{ customerRef: 'cus_123', units: 1 }] })

    expect(assignCredits).toHaveBeenCalledWith({ customerRef: 'cus_123', credits: 25000 })
    expect(trackUsageBulk).toHaveBeenCalledWith({
      events: [{ customerRef: 'cus_123', units: 1 }],
    })
  })
})
