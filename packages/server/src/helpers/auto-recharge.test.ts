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
})
