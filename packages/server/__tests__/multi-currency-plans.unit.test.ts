import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSolvaPayClient } from '../src/client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getFetchBody(index = 0): Record<string, unknown> {
  const fetchMock = vi.mocked(fetch)
  const call = fetchMock.mock.calls[index]
  if (!call?.[1]?.body) throw new Error(`Missing fetch body at call ${index}`)
  return JSON.parse(String(call[1].body))
}

/**
 * Forces `SOLVAPAY_IMPL=ts` — characterizes the retained TypeScript request
 * body for multi-currency `createPaymentIntent` / plan helpers. Rust dispatch
 * is covered by `client-native-dispatch.unit.test.ts` + Group B fixtures.
 */
describe('multi-currency client transport', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    process.env.SOLVAPAY_IMPL = 'ts'
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
  })

  it('createPaymentIntent includes currency in the SDK request body when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        processorPaymentId: 'pi_test',
        clientSecret: 'cs_test',
        publishableKey: 'pk_test',
        amount: 2200,
        currency: 'EUR',
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sp_sandbox_test',
      apiBaseUrl: 'http://localhost:3001',
    })

    await client.createPaymentIntent!({
      customerRef: 'cus_test',
      productRef: 'prd_test',
      planRef: 'pln_test',
      currency: 'EUR',
    })

    expect(getFetchBody()).toMatchObject({
      customerRef: 'cus_test',
      productRef: 'prd_test',
      planRef: 'pln_test',
      currency: 'EUR',
    })
  })

  it('createPaymentIntent omits currency when not provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        processorPaymentId: 'pi_test',
        clientSecret: 'cs_test',
        publishableKey: 'pk_test',
        amount: 2500,
        currency: 'USD',
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sp_sandbox_test',
      apiBaseUrl: 'http://localhost:3001',
    })

    await client.createPaymentIntent!({
      customerRef: 'cus_test',
      productRef: 'prd_test',
      planRef: 'pln_test',
    })

    expect(getFetchBody()).not.toHaveProperty('currency')
  })

  it('listPlans preserves pricingOptions on unwrapped plan objects', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        plans: [
          {
            reference: 'pln_multi',
            price: 2500,
            currency: 'USD',
            pricingOptions: [
              { currency: 'USD', price: 2500, default: true },
              { currency: 'EUR', price: 2200 },
            ],
          },
        ],
      }),
    )

    const client = createSolvaPayClient({
      apiKey: 'sp_sandbox_test',
      apiBaseUrl: 'http://localhost:3001',
    })

    const plans = await client.listPlans!('prd_test')
    expect(plans[0]?.pricingOptions).toEqual([
      { currency: 'USD', price: 2500, default: true },
      { currency: 'EUR', price: 2200 },
    ])
  })
})
