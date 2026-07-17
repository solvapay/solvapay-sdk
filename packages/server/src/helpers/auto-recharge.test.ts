import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('./customer', () => ({
  syncCustomerCore: vi.fn(),
}))

vi.mock('./error', () => ({
  isErrorResult: vi.fn(
    (result: unknown) =>
      typeof result === 'object' && result !== null && 'error' in result && 'status' in result,
  ),
  handleRouteError: vi.fn((_error: unknown, _operation: string, message?: string) => ({
    error: message ?? 'operation failed',
    status: 500,
  })),
}))

import { createSolvaPay } from '../factory'
import { syncCustomerCore } from './customer'
import { disableAutoRechargeCore, getAutoRechargeCore, saveAutoRechargeCore } from './auto-recharge'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)
const mockSyncCustomerCore = vi.mocked(syncCustomerCore)

function makeRequest(): Request {
  return new Request('http://localhost/api/auto-recharge')
}

describe('auto-recharge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomerCore.mockResolvedValue('cus_123')
  })

  it('gets auto-recharge for the synced customer', async () => {
    const getAutoRecharge = vi.fn().mockResolvedValue({ config: null })
    mockCreateSolvaPay.mockReturnValue({ apiClient: { getAutoRecharge } } as never)

    const result = await getAutoRechargeCore(makeRequest())

    expect(getAutoRecharge).toHaveBeenCalledWith({ customerRef: 'cus_123' })
    expect(result).toEqual({ config: null })
  })

  it('saves auto-recharge for the synced customer', async () => {
    const saveAutoRecharge = vi.fn().mockResolvedValue({ config: { enabled: true } })
    mockCreateSolvaPay.mockReturnValue({ apiClient: { saveAutoRecharge } } as never)

    const input = {
      enabled: true,
      triggerType: 'balance' as const,
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
    }

    const result = await saveAutoRechargeCore(makeRequest(), input)

    expect(saveAutoRecharge).toHaveBeenCalledWith({ customerRef: 'cus_123', ...input })
    expect(result).toEqual({ config: { enabled: true } })
  })

  it('disables auto-recharge for the synced customer', async () => {
    const disableAutoRecharge = vi.fn().mockResolvedValue({ success: true })
    mockCreateSolvaPay.mockReturnValue({ apiClient: { disableAutoRecharge } } as never)

    const result = await disableAutoRechargeCore(makeRequest())

    expect(disableAutoRecharge).toHaveBeenCalledWith({ customerRef: 'cus_123' })
    expect(result).toEqual({ success: true })
  })

  it('propagates syncCustomerCore errors from getAutoRechargeCore', async () => {
    mockSyncCustomerCore.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await getAutoRechargeCore(makeRequest())

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
  })

  it('propagates syncCustomerCore errors from saveAutoRechargeCore', async () => {
    mockSyncCustomerCore.mockResolvedValue({ error: 'Unauthorized', status: 401 })

    const result = await saveAutoRechargeCore(makeRequest(), {
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
    })

    expect(result).toEqual({ error: 'Unauthorized', status: 401 })
  })

  it('propagates syncCustomerCore errors from disableAutoRechargeCore', async () => {
    mockSyncCustomerCore.mockResolvedValue({ error: 'Unauthorized', status: 401 })

    const result = await disableAutoRechargeCore(makeRequest())

    expect(result).toEqual({ error: 'Unauthorized', status: 401 })
  })

  it('returns 500 when getAutoRecharge is missing on the API client', async () => {
    mockCreateSolvaPay.mockReturnValue({ apiClient: {} } as never)

    const result = await getAutoRechargeCore(makeRequest())

    expect(result).toEqual({
      error: 'getAutoRecharge is not implemented on this API client',
      status: 500,
    })
  })

  it('returns 500 when saveAutoRecharge is missing on the API client', async () => {
    mockCreateSolvaPay.mockReturnValue({ apiClient: {} } as never)

    const result = await saveAutoRechargeCore(makeRequest(), {
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
    })

    expect(result).toEqual({
      error: 'saveAutoRecharge is not implemented on this API client',
      status: 500,
    })
  })

  it('returns 500 when disableAutoRecharge is missing on the API client', async () => {
    mockCreateSolvaPay.mockReturnValue({ apiClient: {} } as never)

    const result = await disableAutoRechargeCore(makeRequest())

    expect(result).toEqual({
      error: 'disableAutoRecharge is not implemented on this API client',
      status: 500,
    })
  })

  it('wraps thrown getAutoRecharge errors with handleRouteError', async () => {
    const getAutoRecharge = vi.fn().mockRejectedValue(new Error('Backend exploded'))
    mockCreateSolvaPay.mockReturnValue({ apiClient: { getAutoRecharge } } as never)

    const result = await getAutoRechargeCore(makeRequest())

    expect(result).toEqual({
      error: 'Failed to load auto-recharge',
      status: 500,
    })
  })

  it('wraps thrown saveAutoRecharge errors with handleRouteError', async () => {
    const saveAutoRecharge = vi.fn().mockRejectedValue(new Error('Backend exploded'))
    mockCreateSolvaPay.mockReturnValue({ apiClient: { saveAutoRecharge } } as never)

    const result = await saveAutoRechargeCore(makeRequest(), {
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: 5,
      topupAmountMajor: 10,
      currency: 'USD',
    })

    expect(result).toEqual({
      error: 'Failed to save auto-recharge',
      status: 500,
    })
  })

  it('wraps thrown disableAutoRecharge errors with handleRouteError', async () => {
    const disableAutoRecharge = vi.fn().mockRejectedValue(new Error('Backend exploded'))
    mockCreateSolvaPay.mockReturnValue({ apiClient: { disableAutoRecharge } } as never)

    const result = await disableAutoRechargeCore(makeRequest())

    expect(result).toEqual({
      error: 'Failed to disable auto-recharge',
      status: 500,
    })
  })

  it('passes includeEmail and includeName through to syncCustomerCore', async () => {
    const getAutoRecharge = vi.fn().mockResolvedValue({ config: null })
    mockCreateSolvaPay.mockReturnValue({ apiClient: { getAutoRecharge } } as never)

    await getAutoRechargeCore(makeRequest(), {
      includeEmail: false,
      includeName: false,
    })

    expect(mockSyncCustomerCore).toHaveBeenCalledWith(expect.any(Request), {
      solvaPay: undefined,
      includeEmail: false,
      includeName: false,
    })
  })
})
