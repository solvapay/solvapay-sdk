import { describe, it, expect, vi } from 'vitest'
import { createTransportCacheKey } from '../cache-key'
import type { SolvaPayTransport } from '../types'
import type { SolvaPayConfig } from '../../types'

function fakeTransport(): SolvaPayTransport {
  return {
    checkPurchase: vi.fn(),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    getBalance: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn(),
    getProduct: vi.fn(),
    listPlans: vi.fn(),
    getPaymentMethod: vi.fn(),
  }
}

describe('createTransportCacheKey', () => {
  it('returns the fallback route when no transport is configured', () => {
    const key = createTransportCacheKey(undefined, '/api/merchant')
    expect(key).toBe('/api/merchant')
  })

  it('ignores the suffix in non-transport mode (fallback route is used verbatim)', () => {
    const config: SolvaPayConfig = {}
    // useProduct passes `productRef` as both fallback and suffix; without a
    // transport the key must stay `productRef`, not `productRef:productRef`.
    expect(createTransportCacheKey(config, 'prd_42', 'prd_42')).toBe('prd_42')
    expect(createTransportCacheKey(config, '/api/merchant', 'ignored')).toBe('/api/merchant')
  })

  it('assigns a stable transport id and reuses it across calls', () => {
    const transport = fakeTransport()
    const config: SolvaPayConfig = { transport }

    const first = createTransportCacheKey(config, '/unused')
    const second = createTransportCacheKey(config, '/unused')
    const withSuffix = createTransportCacheKey(config, '/unused', 'prd_42')

    expect(first).toMatch(/^transport:\d+$/)
    expect(second).toBe(first)
    // Same transport, same id, suffix applied
    const id = first.split(':')[1]
    expect(withSuffix).toBe(`transport:${id}:prd_42`)
  })

  it('assigns distinct ids to distinct transport instances', () => {
    const a = fakeTransport()
    const b = fakeTransport()

    const keyA = createTransportCacheKey({ transport: a }, '/unused')
    const keyB = createTransportCacheKey({ transport: b }, '/unused')

    expect(keyA).toMatch(/^transport:\d+$/)
    expect(keyB).toMatch(/^transport:\d+$/)
    expect(keyA).not.toBe(keyB)
  })
})
