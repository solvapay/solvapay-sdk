import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSolvaPayClient } from '../src/client'
import { SolvaPayError } from '@solvapay/core'

/**
 * Forces `SOLVAPAY_IMPL=ts` — characterizes TypeScript fetch error mapping
 * (HTTP status on `SolvaPayError`). Rust envelope reconstruction is covered by
 * `native-dispatch.unit.test.ts` / `client-native-dispatch.unit.test.ts`.
 */
describe('createSolvaPayClient — SolvaPayError carries upstream HTTP status', () => {
  const apiKey = 'sk_test_123'
  const baseUrl = 'https://api.solvapay.com'
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    process.env.SOLVAPAY_IMPL = 'ts'
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
  })

  it('preserves 404 status when getMerchant returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Provider not found', { status: 404 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toMatchObject({
      name: 'SolvaPayError',
      status: 404,
    })
  })

  it('preserves 401 status on checkLimits', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.checkLimits({ productRef: 'prd_1', resource: 'tool', units: 1 }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('preserves 400 status on createTopupPaymentIntent failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Bad Request', { status: 400 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(
      client.createTopupPaymentIntent!({
        customerRef: 'cus_1',
        amount: -100,
        currency: 'usd',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('preserves 404 status on getProduct', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getProduct('prd_missing')).rejects.toMatchObject({ status: 404 })
  })

  it('still throws a SolvaPayError instance (backwards compatible)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    )

    const client = createSolvaPayClient({ apiKey, apiBaseUrl: baseUrl })

    await expect(client.getMerchant!()).rejects.toBeInstanceOf(SolvaPayError)
  })

  it('still throws SolvaPayError without status when apiKey missing (config error)', () => {
    expect(() => createSolvaPayClient({ apiKey: '' })).toThrow(SolvaPayError)
    try {
      createSolvaPayClient({ apiKey: '' })
    } catch (e) {
      expect(e).toBeInstanceOf(SolvaPayError)
      expect((e as SolvaPayError).status).toBeUndefined()
    }
  })
})
