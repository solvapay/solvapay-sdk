import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTopupPaymentIntentCore, isErrorResult } from '../src/helpers'
import type { ErrorResult } from '../src/helpers'

// Mock the dependencies
vi.mock('../src/helpers/auth', () => ({
  getAuthenticatedUserCore: vi.fn(),
}))

vi.mock('../src/helpers/customer', () => ({
  syncCustomerCore: vi.fn(),
}))

vi.mock('../src/factory', () => ({
  createSolvaPay: vi.fn(),
}))

import { syncCustomerCore } from '../src/helpers/customer'
import { createSolvaPay } from '../src/factory'

const mockSyncCustomer = vi.mocked(syncCustomerCore)
const mockCreateSolvaPay = vi.mocked(createSolvaPay)

function makeRequest(): Request {
  return new Request('https://example.com/api/topup', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
  })
}

describe('createTopupPaymentIntentCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when amount is missing', async () => {
    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 0, currency: 'usd' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect((result as ErrorResult).status).toBe(400)
    expect((result as ErrorResult).error).toMatch(/amount/)
  })

  it('returns error when amount is negative', async () => {
    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: -500, currency: 'usd' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect((result as ErrorResult).status).toBe(400)
    expect((result as ErrorResult).error).toMatch(/amount/)
  })

  it('returns error when currency is missing', async () => {
    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 1000, currency: '' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect((result as ErrorResult).status).toBe(400)
    expect((result as ErrorResult).error).toMatch(/currency/)
  })

  it('returns syncCustomer error when customer sync fails', async () => {
    const syncError: ErrorResult = { error: 'Unauthorized', status: 401 }
    mockSyncCustomer.mockResolvedValueOnce(syncError)

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 1000, currency: 'usd' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toEqual(syncError)
  })

  it('syncs customer then creates topup payment intent', async () => {
    const mockPaymentIntent = {
      id: 'pi_topup_abc',
      clientSecret: 'pi_topup_abc_secret',
      publishableKey: 'pk_test_xyz',
      accountId: 'acct_123',
    }

    mockSyncCustomer.mockResolvedValueOnce('cus_TOPUP1')

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce(mockPaymentIntent),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 5000, currency: 'usd', description: 'Top up credits' },
    )

    expect(isErrorResult(result)).toBe(false)
    expect(result).toEqual({
      id: 'pi_topup_abc',
      clientSecret: 'pi_topup_abc_secret',
      publishableKey: 'pk_test_xyz',
      accountId: 'acct_123',
      customerRef: 'cus_TOPUP1',
    })

    expect(mockSolvaPay.createTopupPaymentIntent).toHaveBeenCalledWith({
      customerRef: 'cus_TOPUP1',
      amount: 5000,
      currency: 'usd',
      description: 'Top up credits',
    })
  })

  it('returns customerRef in successful response', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_REF_42')

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        id: 'pi_1',
        clientSecret: 'cs_1',
        publishableKey: 'pk_1',
      }),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 2000, currency: 'eur' },
    )

    expect(isErrorResult(result)).toBe(false)
    const success = result as { customerRef: string }
    expect(success.customerRef).toBe('cus_REF_42')
  })

  it('handles API errors gracefully', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_ERR')

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockRejectedValueOnce(new Error('Internal server error')),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 1000, currency: 'usd' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect((result as ErrorResult).status).toBe(500)
  })

  it('uses provided solvaPay instance instead of creating new one', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_PROVIDED')

    const providedSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        id: 'pi_p',
        clientSecret: 'cs_p',
        publishableKey: 'pk_p',
      }),
    }

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 3000, currency: 'gbp' },
      { solvaPay: providedSolvaPay as any },
    )

    expect(isErrorResult(result)).toBe(false)
    expect(providedSolvaPay.createTopupPaymentIntent).toHaveBeenCalled()
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })
})
