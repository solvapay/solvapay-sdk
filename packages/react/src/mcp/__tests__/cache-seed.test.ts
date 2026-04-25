import { describe, expect, it, beforeEach, vi } from 'vitest'
import { seedMcpCaches } from '../cache-seed'
import { merchantCache } from '../../hooks/useMerchant'
import { productCache } from '../../hooks/useProduct'
import { plansCache } from '../../hooks/usePlans'
import { paymentMethodCache } from '../../hooks/usePaymentMethod'
import type {
  Merchant,
  Plan,
  Product,
  SolvaPayConfig,
  SolvaPayProviderInitial,
} from '../../types'
import type { SolvaPayTransport } from '../../transport/types'

function makeTransport(): SolvaPayTransport {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeInitial(
  overrides: Partial<SolvaPayProviderInitial> = {},
): SolvaPayProviderInitial {
  const merchant: Merchant = {
    displayName: 'Acme',
    legalName: 'Acme Inc',
  }
  const product: Product = { reference: 'prd_test', name: 'Test' }
  const plans: Plan[] = [{ reference: 'pln_basic' }]
  return {
    customerRef: 'cus_42',
    purchase: null,
    paymentMethod: null,
    balance: null,
    usage: null,
    merchant,
    product,
    plans,
    ...overrides,
  }
}

describe('seedMcpCaches', () => {
  beforeEach(() => {
    merchantCache.clear()
    productCache.clear()
    plansCache.clear()
    paymentMethodCache.clear()
  })

  it('seeds merchant/product/plans cache so hooks can hit them synchronously', () => {
    const config: SolvaPayConfig = { transport: makeTransport() }
    seedMcpCaches(makeInitial(), config)

    // merchantCache is keyed by transport id
    expect([...merchantCache.values()][0]?.merchant?.displayName).toBe('Acme')
    expect([...productCache.values()][0]?.product?.reference).toBe('prd_test')
    expect(plansCache.get('prd_test')?.plans).toHaveLength(1)
  })

  it('seeds paymentMethod only when customerRef + paymentMethod both present', () => {
    const config: SolvaPayConfig = { transport: makeTransport() }
    seedMcpCaches(
      makeInitial({ paymentMethod: { kind: 'card', brand: 'visa', last4: '4242' } }),
      config,
    )
    expect(paymentMethodCache.size).toBe(1)

    paymentMethodCache.clear()
    seedMcpCaches(makeInitial({ paymentMethod: null }), config)
    expect(paymentMethodCache.size).toBe(0)
  })

  it('skips payment-method seed when customerRef is null', () => {
    const config: SolvaPayConfig = { transport: makeTransport() }
    seedMcpCaches(
      makeInitial({
        customerRef: null,
        paymentMethod: { kind: 'card', brand: 'visa', last4: '4242' },
      }),
      config,
    )
    expect(paymentMethodCache.size).toBe(0)
  })
})
