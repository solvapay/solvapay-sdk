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
import { getHistoryCore } from './history'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)
const mockSyncCustomerCore = vi.mocked(syncCustomerCore)

function makeRequest(): Request {
  return new Request('http://localhost/api/history')
}

const purchase = {
  reference: 'pur_1',
  customerRef: 'cus_123',
  productRef: 'prd_widget',
  productName: 'Cool MCP',
  status: 'active',
  startDate: '2026-09-01T00:00:00.000Z',
  amount: 3000,
  currency: 'USD',
  isRecurring: true,
  createdAt: '2026-09-01T00:00:00.000Z',
}

const activity = {
  entries: [
    {
      type: 'USAGE' as const,
      amount: -200,
      balance: 599800,
      productName: 'Cool MCP',
      productRef: 'prd_widget',
      timestamp: '2026-09-05T14:22:00.000Z',
    },
  ],
  hasMore: true,
}

describe('getHistoryCore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomerCore.mockResolvedValue('cus_123')
  })

  it('loads product-scoped charges and account-wide credit activity in parallel', async () => {
    const listPurchases = vi.fn().mockResolvedValue({ purchases: [purchase] })
    const getCreditActivity = vi.fn().mockResolvedValue(activity)
    mockCreateSolvaPay.mockReturnValue({
      apiClient: { listPurchases, getCreditActivity },
    } as never)

    const result = await getHistoryCore(makeRequest(), {
      productRef: 'prd_widget',
      limit: 20,
    })

    expect(listPurchases).toHaveBeenCalledWith({
      customerRef: 'cus_123',
      productRef: 'prd_widget',
    })
    expect(getCreditActivity).toHaveBeenCalledWith({
      customerRef: 'cus_123',
      limit: 20,
    })
    expect(result).toEqual({
      charges: [purchase],
      creditActivity: activity,
    })
  })

  it('returns empty charges when the purchases list is empty', async () => {
    mockCreateSolvaPay.mockReturnValue({
      apiClient: {
        listPurchases: vi.fn().mockResolvedValue({ purchases: [] }),
        getCreditActivity: vi.fn().mockResolvedValue({ entries: [], hasMore: false }),
      },
    } as never)

    const result = await getHistoryCore(makeRequest(), { productRef: 'prd_widget' })

    expect(result).toEqual({
      charges: [],
      creditActivity: { entries: [], hasMore: false },
    })
  })

  it('fails loudly when listPurchases is missing on the API client', async () => {
    mockCreateSolvaPay.mockReturnValue({
      apiClient: {
        getCreditActivity: vi.fn(),
      },
    } as never)

    const result = await getHistoryCore(makeRequest(), { productRef: 'prd_widget' })

    expect(result).toEqual({
      error: 'listPurchases is not implemented on this API client',
      status: 500,
    })
  })

  it('fails loudly when getCreditActivity is missing on the API client', async () => {
    mockCreateSolvaPay.mockReturnValue({
      apiClient: {
        listPurchases: vi.fn(),
      },
    } as never)

    const result = await getHistoryCore(makeRequest(), { productRef: 'prd_widget' })

    expect(result).toEqual({
      error: 'getCreditActivity is not implemented on this API client',
      status: 500,
    })
  })

  it('propagates a missing customer from sync', async () => {
    mockSyncCustomerCore.mockResolvedValue({ error: 'Unauthorized', status: 401 })

    const result = await getHistoryCore(makeRequest(), { productRef: 'prd_widget' })

    expect(result).toEqual({ error: 'Unauthorized', status: 401 })
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })
})
