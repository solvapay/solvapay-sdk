import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('./customer', () => ({
  syncCustomerCore: vi.fn(),
}))

vi.mock('./error', () => ({
  isErrorResult: vi.fn(
    (r: unknown) => typeof r === 'object' && r !== null && 'error' in r && 'status' in r,
  ),
  handleRouteError: vi.fn((_error: unknown, opName: string, msg?: string) => ({
    error: msg || `${opName} failed`,
    status: 500,
  })),
}))

import { createSolvaPay } from '../factory'
import { syncCustomerCore } from './customer'
import { createCheckoutSessionCore, createCustomerSessionCore } from './checkout'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)
const mockSyncCustomer = vi.mocked(syncCustomerCore)

describe('createCheckoutSessionCore', () => {
  const mockCreateCheckoutSession = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    mockCreateCheckoutSession.mockResolvedValue({
      sessionId: 'cs_test',
      checkoutUrl: 'https://checkout.example/session',
    })
    mockCreateSolvaPay.mockReturnValue({
      createCheckoutSession: mockCreateCheckoutSession,
    } as never)
  })

  it('rejects requests missing productRef with status 400', async () => {
    const result = await createCheckoutSessionCore(new Request('http://localhost/api/checkout'), {
      productRef: '',
    })
    expect(result).toEqual({
      error: 'Missing required parameter: productRef is required',
      status: 400,
    })
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('creates a checkout session on the happy path', async () => {
    const result = await createCheckoutSessionCore(
      new Request('http://localhost/api/checkout'),
      { productRef: 'prd_test', planRef: 'pln_test' },
      {
        solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never,
      },
    )

    expect(mockSyncCustomer).toHaveBeenCalled()
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith({
      productRef: 'prd_test',
      customerRef: 'cus_ABC',
      planRef: 'pln_test',
      returnUrl: 'http://localhost',
    })
    expect(result).toEqual({
      sessionId: 'cs_test',
      checkoutUrl: 'https://checkout.example/session',
    })
  })

  it('prefers body.returnUrl over options and origin', async () => {
    await createCheckoutSessionCore(
      new Request('http://localhost/api/checkout'),
      {
        productRef: 'prd_test',
        returnUrl: 'https://body.example/return',
      },
      {
        returnUrl: 'https://options.example/return',
        solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never,
      },
    )

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: 'https://body.example/return' }),
    )
  })

  it('falls back to options.returnUrl when body omits it', async () => {
    await createCheckoutSessionCore(
      new Request('http://localhost/api/checkout'),
      { productRef: 'prd_test' },
      {
        returnUrl: 'https://options.example/return',
        solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never,
      },
    )

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: 'https://options.example/return' }),
    )
  })

  it('falls back to request origin when body and options omit returnUrl', async () => {
    await createCheckoutSessionCore(
      new Request('https://app.example.com/api/checkout'),
      { productRef: 'prd_test' },
      { solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never },
    )

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: 'https://app.example.com' }),
    )
  })

  it('continues without returnUrl when the request URL is unparseable', async () => {
    // Relative URLs without a base throw in `new URL(...)`.
    await createCheckoutSessionCore(
      { url: '/relative-path' } as Request,
      { productRef: 'prd_test' },
      { solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never },
    )

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith({
      productRef: 'prd_test',
      customerRef: 'cus_ABC',
      planRef: undefined,
      returnUrl: undefined,
    })
  })

  it('treats empty-string returnUrl as falsy and falls through to origin', async () => {
    await createCheckoutSessionCore(
      new Request('http://localhost/api/checkout'),
      { productRef: 'prd_test', returnUrl: '' },
      {
        returnUrl: '',
        solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never,
      },
    )

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ returnUrl: 'http://localhost' }),
    )
  })

  it('propagates syncCustomerCore errors verbatim', async () => {
    mockSyncCustomer.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })

    const result = await createCheckoutSessionCore(new Request('http://localhost'), {
      productRef: 'prd_test',
    })

    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('wraps thrown errors with handleRouteError', async () => {
    mockCreateCheckoutSession.mockRejectedValue(new Error('Backend exploded'))

    const result = await createCheckoutSessionCore(
      new Request('http://localhost'),
      { productRef: 'prd_test' },
      { solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never },
    )

    expect(result).toEqual({
      error: 'Checkout session creation failed',
      status: 500,
    })
  })

  it('coerces empty planRef to undefined', async () => {
    await createCheckoutSessionCore(
      new Request('http://localhost'),
      { productRef: 'prd_test', planRef: '' },
      { solvaPay: { createCheckoutSession: mockCreateCheckoutSession } as never },
    )

    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ planRef: undefined }),
    )
  })
})

describe('createCustomerSessionCore', () => {
  const mockCreateCustomerSession = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    mockCreateCustomerSession.mockResolvedValue({
      sessionId: 'cust_sess',
      customerUrl: 'https://customer.example/session',
    })
  })

  it('creates a customer session on the happy path', async () => {
    const result = await createCustomerSessionCore(new Request('http://localhost'), {
      solvaPay: { createCustomerSession: mockCreateCustomerSession } as never,
    })

    expect(mockCreateCustomerSession).toHaveBeenCalledWith({ customerRef: 'cus_ABC' })
    expect(result).toEqual({
      sessionId: 'cust_sess',
      customerUrl: 'https://customer.example/session',
    })
  })

  it('propagates syncCustomerCore errors verbatim', async () => {
    mockSyncCustomer.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
    })

    const result = await createCustomerSessionCore(new Request('http://localhost'))

    expect(result).toEqual({ error: 'Unauthorized', status: 401 })
    expect(mockCreateCustomerSession).not.toHaveBeenCalled()
  })
})
