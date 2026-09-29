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
      { amount: 0, currency: 'USD' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toStrictEqual({
      error: 'Missing or invalid amount: must be a positive number',
      status: 400,
    })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })

  it('returns error when amount is negative', async () => {
    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: -500, currency: 'USD' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toStrictEqual({
      error: 'Missing or invalid amount: must be a positive number',
      status: 400,
    })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
  })

  it('returns error when currency is missing', async () => {
    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 1000, currency: '' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toStrictEqual({ error: 'Missing required parameter: currency', status: 400 })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
  })

  it('returns 400 when currency is not uppercase ISO 4217', async () => {
    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 1000, currency: 'usd' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toStrictEqual({
      error: 'Invalid currency "usd": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")',
      status: 400,
    })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
  })

  it('returns syncCustomer error when customer sync fails', async () => {
    const syncError: ErrorResult = { error: 'Unauthorized', status: 401 }
    mockSyncCustomer.mockResolvedValueOnce(syncError)

    const request = makeRequest()
    const result = await createTopupPaymentIntentCore(
      request,
      { amount: 1000, currency: 'USD' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toStrictEqual(syncError)
    expect(mockSyncCustomer).toHaveBeenCalledTimes(1)
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, {
      solvaPay: undefined,
      includeEmail: undefined,
      includeName: undefined,
    })
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })

  it('syncs customer then creates topup payment intent', async () => {
    const mockPaymentIntent = {
      id: 'pi_sp_topup_abc',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      processorPaymentId: 'pi_topup_abc',
      clientSecret: 'legacy_secret_dropped',
    }

    mockSyncCustomer.mockResolvedValueOnce('cus_TOPUP1')

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce(mockPaymentIntent),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const request = makeRequest()
    const result = await createTopupPaymentIntentCore(
      request,
      { amount: 5000, currency: 'USD', description: 'Top up credits' },
    )

    expect(isErrorResult(result)).toBe(false)
    expect(result).toStrictEqual({
      id: 'pi_sp_topup_abc',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      processorPaymentId: 'pi_topup_abc',
      customerRef: 'cus_TOPUP1',
    })

    expect(mockSyncCustomer).toHaveBeenCalledTimes(1)
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, {
      solvaPay: undefined,
      includeEmail: undefined,
      includeName: undefined,
    })
    expect(mockCreateSolvaPay).toHaveBeenCalledTimes(1)
    expect(mockCreateSolvaPay).toHaveBeenCalledWith()
    expect(mockSolvaPay.createTopupPaymentIntent).toHaveBeenCalledTimes(1)
    expect(mockSolvaPay.createTopupPaymentIntent).toHaveBeenCalledWith({
      customerRef: 'cus_TOPUP1',
      amount: 5000,
      currency: 'USD',
      description: 'Top up credits',
    })
    expect(mockSolvaPay.createTopupPaymentIntent.mock.calls[0][0]).not.toHaveProperty('autoRecharge')
  })

  it('forwards includeEmail / includeName to the customer sync', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_TOPUP1')
    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        processorPaymentId: 'pi_1',
        id: 'pi_sp_1',
        captureMode: 'vault',
        vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      }),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const request = makeRequest()
    await createTopupPaymentIntentCore(
      request,
      { amount: 1000, currency: 'USD' },
      { includeEmail: false, includeName: true },
    )

    expect(mockSyncCustomer).toHaveBeenCalledWith(request, {
      solvaPay: undefined,
      includeEmail: false,
      includeName: true,
    })
  })

  it('forwards autoRecharge in the topup payment intent request', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_TOPUP1')

    const autoRecharge = {
      enabled: true,
      triggerType: 'balance' as const,
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
    }

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        processorPaymentId: 'pi_topup_auto',
        id: 'pi_sp_1',
        captureMode: 'vault',
        vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      }),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 5000, currency: 'USD', autoRecharge },
    )

    expect(mockSolvaPay.createTopupPaymentIntent).toHaveBeenCalledTimes(1)
    expect(mockSolvaPay.createTopupPaymentIntent).toHaveBeenCalledWith({
      customerRef: 'cus_TOPUP1',
      amount: 5000,
      currency: 'USD',
      description: undefined,
      autoRecharge,
    })
    expect(result).toStrictEqual({
      processorPaymentId: 'pi_topup_auto',
      id: 'pi_sp_1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_TOPUP1',
    })
  })

  it('returns customerRef in successful response', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_REF_42')

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        processorPaymentId: 'pi_1',
        id: 'pi_sp_1',
        captureMode: 'vault',
        vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      }),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 2000, currency: 'EUR' },
    )

    expect(isErrorResult(result)).toBe(false)
    expect(result).toStrictEqual({
      processorPaymentId: 'pi_1',
      id: 'pi_sp_1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_REF_42',
    })
    expect(mockSolvaPay.createTopupPaymentIntent).toHaveBeenCalledWith({
      customerRef: 'cus_REF_42',
      amount: 2000,
      currency: 'EUR',
      description: undefined,
    })
  })

  it('passes vault-mode intents through with id and vault and no client secret', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_VAULT')
    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        id: '66f1c2d3e4f5a6b7c8d9e0f1',
        captureMode: 'vault',
        vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
        amount: 2500,
        currency: 'USD',
        status: 'pending',
      }),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)

    const result = await createTopupPaymentIntentCore(makeRequest(), { amount: 2500, currency: 'USD' })

    expect(result).toStrictEqual({
      id: '66f1c2d3e4f5a6b7c8d9e0f1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_VAULT',
    })
  })

  it('handles API errors gracefully', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_ERR')

    const mockSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockRejectedValueOnce(new Error('Internal server error')),
    }
    mockCreateSolvaPay.mockReturnValueOnce(mockSolvaPay as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createTopupPaymentIntentCore(
      makeRequest(),
      { amount: 1000, currency: 'USD' },
    )

    expect(isErrorResult(result)).toBe(true)
    expect(result).toStrictEqual({
      error: 'Topup payment intent creation failed',
      status: 500,
      details: 'Internal server error',
    })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[Create topup payment intent] Error:', new Error('Internal server error'))
    errorSpy.mockRestore()
  })

  it('uses provided solvaPay instance instead of creating new one', async () => {
    mockSyncCustomer.mockResolvedValueOnce('cus_PROVIDED')

    const providedSolvaPay = {
      createTopupPaymentIntent: vi.fn().mockResolvedValueOnce({
        processorPaymentId: 'pi_p',
        id: 'pi_sp_1',
        captureMode: 'vault',
        vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      }),
    }

    const request = makeRequest()
    const result = await createTopupPaymentIntentCore(
      request,
      { amount: 3000, currency: 'GBP' },
      { solvaPay: providedSolvaPay as any },
    )

    expect(isErrorResult(result)).toBe(false)
    expect(result).toStrictEqual({
      processorPaymentId: 'pi_p',
      id: 'pi_sp_1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_PROVIDED',
    })
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, {
      solvaPay: providedSolvaPay,
      includeEmail: undefined,
      includeName: undefined,
    })
    expect(providedSolvaPay.createTopupPaymentIntent).toHaveBeenCalledTimes(1)
    expect(providedSolvaPay.createTopupPaymentIntent).toHaveBeenCalledWith({
      customerRef: 'cus_PROVIDED',
      amount: 3000,
      currency: 'GBP',
      description: undefined,
    })
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })
})
