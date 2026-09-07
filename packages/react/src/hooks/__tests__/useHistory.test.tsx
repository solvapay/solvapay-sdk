import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GetHistoryResult } from '@solvapay/server'
import { useCustomer } from '../useCustomer'
import { useHistory, historyCache } from '../useHistory'
import { useTransport } from '../useTransport'

vi.mock('../useCustomer', () => ({
  useCustomer: vi.fn(),
}))
vi.mock('../useTransport', () => ({
  useTransport: vi.fn(),
}))

const mockedUseCustomer = vi.mocked(useCustomer)
const mockedUseTransport = vi.mocked(useTransport)

const history: GetHistoryResult = {
  charges: [
    {
      reference: 'pur_1',
      customerRef: 'cus_test',
      productRef: 'prd_widget',
      status: 'active',
      startDate: '2026-09-01T00:00:00.000Z',
      amount: 3000,
      currency: 'USD',
      isRecurring: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  creditActivity: {
    entries: [
      {
        type: 'USAGE',
        amount: -200,
        balance: 599800,
        productName: 'Cool MCP',
        productRef: 'prd_widget',
        timestamp: '2026-09-05T14:22:00.000Z',
      },
    ],
    hasMore: false,
  },
}

function setCustomer(customerRef: string | undefined = 'cus_test') {
  mockedUseCustomer.mockReturnValue({
    customerRef,
    email: undefined,
    name: undefined,
    loading: false,
  })
}

function setTransport(override: Record<string, unknown> = {}) {
  mockedUseTransport.mockReturnValue({
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    ...override,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

beforeEach(() => {
  historyCache.clear()
  vi.clearAllMocks()
  setCustomer()
})

describe('useHistory', () => {
  it('fetches charges and credit activity when enabled', async () => {
    const getHistory = vi.fn().mockResolvedValue(history)
    setTransport({ getHistory })

    const { result } = renderHook(() =>
      useHistory({ productRef: 'prd_widget', enabled: true }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getHistory).toHaveBeenCalledWith({ productRef: 'prd_widget' })
    expect(result.current.charges).toEqual(history.charges)
    expect(result.current.creditActivity).toEqual(history.creditActivity)
    expect(result.current.error).toBeNull()
  })

  it('does not fetch when enabled is false', async () => {
    const getHistory = vi.fn().mockResolvedValue(history)
    setTransport({ getHistory })

    const { result } = renderHook(() =>
      useHistory({ productRef: 'prd_widget', enabled: false }),
    )

    expect(result.current.loading).toBe(false)
    expect(result.current.charges).toBeNull()
    expect(getHistory).not.toHaveBeenCalled()
  })

  it('does not fetch when productRef is missing', async () => {
    const getHistory = vi.fn().mockResolvedValue(history)
    setTransport({ getHistory })

    const { result } = renderHook(() => useHistory({ enabled: true }))

    expect(result.current.loading).toBe(false)
    expect(getHistory).not.toHaveBeenCalled()
  })

  it('stays idle when the transport omits getHistory', async () => {
    setTransport()

    const { result } = renderHook(() =>
      useHistory({ productRef: 'prd_widget', enabled: true }),
    )

    expect(result.current.loading).toBe(false)
    expect(result.current.charges).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('surfaces a failed fetch distinctly from an empty list', async () => {
    setTransport({
      getHistory: vi.fn().mockRejectedValue(new Error('history unavailable')),
    })

    const { result } = renderHook(() =>
      useHistory({ productRef: 'prd_widget', enabled: true }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.charges).toBeNull()
    expect(result.current.creditActivity).toBeNull()
    expect(result.current.error).toEqual(expect.objectContaining({ message: 'history unavailable' }))
  })

  it('treats a successful empty payload as empty, not failed', async () => {
    setTransport({
      getHistory: vi.fn().mockResolvedValue({
        charges: [],
        creditActivity: { entries: [], hasMore: false },
      }),
    })

    const { result } = renderHook(() =>
      useHistory({ productRef: 'prd_widget', enabled: true }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.charges).toEqual([])
    expect(result.current.creditActivity).toEqual({ entries: [], hasMore: false })
    expect(result.current.error).toBeNull()
  })
})
