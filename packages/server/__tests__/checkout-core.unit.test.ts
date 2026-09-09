import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/helpers/customer', () => ({
  syncCustomerCore: vi.fn(),
}))

import { syncCustomerCore } from '../src/helpers/customer'
import { createCheckoutSessionCore } from '../src/helpers/checkout'

const mockSyncCustomer = vi.mocked(syncCustomerCore)

describe('createCheckoutSessionCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards purpose credit_topup to createCheckoutSession', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCheckoutSession = vi.fn().mockResolvedValue({
      sessionId: 'sess_top',
      checkoutUrl: 'https://customer.test/checkout/topup?id=sess_top',
    })
    const request = new Request('https://example.test/mcp')

    const result = await createCheckoutSessionCore(
      request,
      { productRef: 'prd_1', purpose: 'credit_topup' },
      {
        solvaPay: { createCheckoutSession } as never,
      },
    )

    expect(createCheckoutSession).toHaveBeenCalledWith({
      productRef: 'prd_1',
      customerRef: 'cus_1',
      planRef: undefined,
      returnUrl: 'https://example.test',
      purpose: 'credit_topup',
    })
    expect(result).toEqual({
      sessionId: 'sess_top',
      checkoutUrl: 'https://customer.test/checkout/topup?id=sess_top',
    })
  })

  it('omits returnUrl from createCheckoutSession when body.returnUrl is null', async () => {
    mockSyncCustomer.mockResolvedValue('cus_1')
    const createCheckoutSession = vi.fn().mockResolvedValue({
      sessionId: 'sess_1',
      checkoutUrl: 'https://customer.test/checkout?id=sess_1',
    })
    const request = new Request('https://example.test/mcp')

    await createCheckoutSessionCore(
      request,
      { productRef: 'prd_1', returnUrl: null },
      {
        solvaPay: { createCheckoutSession } as never,
        returnUrl: 'https://should-not-be-used.test',
      },
    )

    expect(createCheckoutSession).toHaveBeenCalledWith({
      productRef: 'prd_1',
      customerRef: 'cus_1',
      planRef: undefined,
    })
    expect(createCheckoutSession.mock.calls[0][0]).not.toHaveProperty('returnUrl')
  })
})
