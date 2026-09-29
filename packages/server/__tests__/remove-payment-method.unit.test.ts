import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('../src/helpers/customer', () => ({
  syncCustomerCore: vi.fn(),
}))

import { SolvaPayError } from '@solvapay/core'
import { createSolvaPay } from '../src/factory'
import { syncCustomerCore } from '../src/helpers/customer'
import { removePaymentMethodCore } from '../src/helpers/payment-method'
import { createSolvaPayClient } from '../src/client'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)
const mockSyncCustomer = vi.mocked(syncCustomerCore)
const removed = {
  removed: { brand: 'visa', last4: '0018', expMonth: 12, expYear: 2030 },
  autoRechargePaused: true,
}

function request() {
  return new Request('http://localhost/api/payment-method', { method: 'DELETE' })
}

describe('removePaymentMethodCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
  })

  it('removes the authenticated customer card on file', async () => {
    const removePaymentMethod = vi.fn().mockResolvedValue(removed)
    mockCreateSolvaPay.mockReturnValue({ apiClient: { removePaymentMethod } } as never)

    const req = request()
    await expect(removePaymentMethodCore(req)).resolves.toStrictEqual(removed)
    expect(mockSyncCustomer).toHaveBeenCalledWith(req, {
      solvaPay: undefined,
      includeEmail: undefined,
      includeName: undefined,
    })
    expect(removePaymentMethod).toHaveBeenCalledTimes(1)
    expect(removePaymentMethod).toHaveBeenCalledWith({ customerRef: 'cus_ABC' })
  })

  it('returns the auth error without calling the API', async () => {
    const removePaymentMethod = vi.fn()
    mockCreateSolvaPay.mockReturnValue({ apiClient: { removePaymentMethod } } as never)
    mockSyncCustomer.mockResolvedValue({ error: 'Unauthorized', status: 401 })

    await expect(removePaymentMethodCore(request())).resolves.toStrictEqual({
      error: 'Unauthorized',
      status: 401,
    })
    expect(removePaymentMethod).not.toHaveBeenCalled()
  })

  it('surfaces no card on file as a 404 error result', async () => {
    const removePaymentMethod = vi
      .fn()
      .mockRejectedValue(
        new SolvaPayError('Remove payment method failed (404): No card on file', {
          status: 404,
        } as never),
      )
    mockCreateSolvaPay.mockReturnValue({ apiClient: { removePaymentMethod } } as never)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await removePaymentMethodCore(request())
    expect(result).toMatchObject({ status: 404 })
  })

  it('reports an API client without removePaymentMethod', async () => {
    mockCreateSolvaPay.mockReturnValue({ apiClient: {} } as never)
    await expect(removePaymentMethodCore(request())).resolves.toStrictEqual({
      error: 'removePaymentMethod is not implemented on this API client',
      status: 500,
    })
  })
})

describe('createSolvaPayClient().removePaymentMethod', () => {
  it('sends DELETE /v1/sdk/payment-method with the customer and returns the removal', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(removed), { status: 200 }))
    const client = createSolvaPayClient({
      apiKey: 'sk_test_1',
      apiBaseUrl: 'https://api.solvapay.com',
    })

    await expect(client.removePaymentMethod!({ customerRef: 'cus_ABC' })).resolves.toStrictEqual(
      removed,
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.solvapay.com/v1/sdk/payment-method?customerRef=cus_ABC')
    expect(options!.method).toBe('DELETE')
    expect((options!.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_1')
    fetchSpy.mockRestore()
  })

  it('throws the API error for no card on file', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'No card on file', statusCode: 404 }), {
          status: 404,
        }),
      )
    const client = createSolvaPayClient({
      apiKey: 'sk_test_1',
      apiBaseUrl: 'https://api.solvapay.com',
    })
    await expect(client.removePaymentMethod!({ customerRef: 'cus_ABC' })).rejects.toMatchObject({
      status: 404,
    })
    fetchSpy.mockRestore()
  })
})
