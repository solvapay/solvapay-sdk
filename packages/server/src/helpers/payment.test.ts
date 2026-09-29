import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
import { handleRouteError } from './error'
import {
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  processTopupPaymentIntentCore,
  attachBusinessDetailsCore,
  createCaptureGrantCore,
  confirmPaymentCore,
} from './payment'

const mockCreateSolvaPay = vi.mocked(createSolvaPay)

function fakeRequest() {
  return new Request('http://localhost/api/process-topup-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createPaymentIntentCore', () => {
  const mockSyncCustomer = vi.mocked(syncCustomerCore)
  const mockCreatePaymentIntent = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    mockCreatePaymentIntent.mockResolvedValue({
      id: 'pi_sp_test',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      processorPaymentId: 'pi_test',
    })
  })

  it('rejects requests missing planRef or productRef with status 400', async () => {
    const result = await createPaymentIntentCore(new Request('http://localhost'), {
      planRef: '',
      productRef: 'prd_test',
    })
    expect(result).toEqual({
      error: 'Missing required parameters: planRef and productRef are required',
      status: 400,
    })
  })

  it('forwards currency to solvaPay.createPaymentIntent when provided', async () => {
    const solvaPay = {
      createPaymentIntent: mockCreatePaymentIntent,
    } as never

    const result = await createPaymentIntentCore(
      new Request('http://localhost'),
      {
        planRef: 'pln_test',
        productRef: 'prd_test',
        currency: 'EUR',
      },
      { solvaPay },
    )

    expect(mockSyncCustomer).toHaveBeenCalled()
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith({
      productRef: 'prd_test',
      planRef: 'pln_test',
      customerRef: 'cus_ABC',
      currency: 'EUR',
    })
    expect(result).toStrictEqual({
      id: 'pi_sp_test',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      processorPaymentId: 'pi_test',
      customerRef: 'cus_ABC',
    })
  })

  it('omits currency when not provided in the request body', async () => {
    const solvaPay = {
      createPaymentIntent: mockCreatePaymentIntent,
    } as never

    await createPaymentIntentCore(
      new Request('http://localhost'),
      {
        planRef: 'pln_test',
        productRef: 'prd_test',
      },
      { solvaPay },
    )

    expect(mockCreatePaymentIntent).toHaveBeenCalledWith({
      productRef: 'prd_test',
      planRef: 'pln_test',
      customerRef: 'cus_ABC',
    })
  })
})

describe('processTopupPaymentIntentCore', () => {
  const mockSyncCustomer = vi.mocked(syncCustomerCore)
  const mockProcessPaymentIntent = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    mockCreateSolvaPay.mockReturnValue({
      processPaymentIntent: mockProcessPaymentIntent,
    } as never)
  })

  it('rejects requests missing paymentIntentId with status 400', async () => {
    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: '',
    })
    expect(result).toEqual({
      error: 'paymentIntentId is required',
      status: 400,
    })
    expect(mockProcessPaymentIntent).not.toHaveBeenCalled()
  })

  it('propagates syncCustomerCore errors verbatim', async () => {
    mockSyncCustomer.mockResolvedValue({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })
    expect(result).toEqual({
      error: 'Unauthorized',
      status: 401,
      details: 'No token provided',
    })
    expect(mockProcessPaymentIntent).not.toHaveBeenCalled()
  })

  it('forwards paymentIntentId to solvaPay.processPaymentIntent with the synced customerRef', async () => {
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    expect(mockSyncCustomer).toHaveBeenCalled()
    expect(mockProcessPaymentIntent).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      customerRef: 'cus_ABC',
    })
    expect(result).toEqual({ status: 'succeeded' })
  })

  it('projects a plan-shaped succeeded response down to the bare topup status', async () => {
    // The backend returns the wider ProcessPaymentResult shape on the
    // same /process endpoint. For a topup PI the `type` / `purchase` /
    // `oneTimePurchase` branches are nonsense — narrow them away here.
    mockProcessPaymentIntent.mockResolvedValue({
      status: 'succeeded',
      type: 'recurring',
      purchase: { reference: 'pur_should_not_leak' },
    })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    expect(result).toEqual({ status: 'succeeded' })
  })

  it('forwards timeout messages on the timeout branch', async () => {
    mockProcessPaymentIntent.mockResolvedValue({
      status: 'timeout',
      message: 'Webhook delayed',
    })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    expect(result).toEqual({ status: 'timeout', message: 'Webhook delayed' })
  })

  it('omits an absent timeout message rather than emitting `message: undefined`', async () => {
    mockProcessPaymentIntent.mockResolvedValue({ status: 'timeout' })
    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })
    expect(result).toEqual({ status: 'timeout' })
  })

  it('returns the bare failed branch', async () => {
    mockProcessPaymentIntent.mockResolvedValue({ status: 'failed' })
    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })
    expect(result).toEqual({ status: 'failed' })
  })

  it('returns the bare cancelled branch', async () => {
    mockProcessPaymentIntent.mockResolvedValue({ status: 'cancelled' })
    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })
    expect(result).toEqual({ status: 'cancelled' })
  })

  it('wraps thrown errors with the standard handleRouteError envelope', async () => {
    mockProcessPaymentIntent.mockRejectedValue(new Error('Backend exploded'))
    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })
    expect(result).toEqual({
      error: 'Topup payment processing failed',
      status: 500,
    })
  })

  it('uses an externally-provided solvaPay instance instead of creating a new one', async () => {
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })
    const externalSolvaPay = {
      processPaymentIntent: mockProcessPaymentIntent,
    } as never

    await processTopupPaymentIntentCore(
      fakeRequest(),
      { paymentIntentId: 'pi_test_123' },
      { solvaPay: externalSolvaPay },
    )

    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------
// Post-success balance polling — backend-authoritative convergence.
//
// `/process` returning `status: 'succeeded'` means the PI is in a
// terminal state, but the rail webhook handler may still be writing
// the TOPUP credit transaction. The helper captures a balance
// baseline before `processPaymentIntent` and polls post-success on a
// backoff until the wallet observes the delta, then returns
// `creditsAdded` so the React side can bump the in-memory balance
// before its deterministic `refetchPurchase()` lands.
// ------------------------------------------------------------------

describe('processTopupPaymentIntentCore — post-success balance polling', () => {
  const mockSyncCustomer = vi.mocked(syncCustomerCore)
  const mockProcessPaymentIntent = vi.fn()
  const mockGetCustomerBalance = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    mockSyncCustomer.mockReset().mockResolvedValue('cus_ABC')
    mockProcessPaymentIntent.mockReset()
    mockGetCustomerBalance.mockReset()
    mockCreateSolvaPay.mockReset().mockReturnValue({
      processPaymentIntent: mockProcessPaymentIntent,
      getCustomerBalance: mockGetCustomerBalance,
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns creditsAdded when the post-success poll observes the wallet delta', async () => {
    mockGetCustomerBalance
      // baseline before /process
      .mockResolvedValueOnce({
        customerRef: 'cus_ABC',
        credits: 100,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 100,
        displayExchangeRate: 1,
      })
      // first post-success poll — webhook has booked credits
      .mockResolvedValueOnce({
        customerRef: 'cus_ABC',
        credits: 250,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 100,
        displayExchangeRate: 1,
      })
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const promise = processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    // Drain pending microtasks + the first setTimeout(500) so the
    // first post-success poll resolves.
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(mockGetCustomerBalance).toHaveBeenCalledTimes(2)
    expect(mockGetCustomerBalance).toHaveBeenNthCalledWith(1, { customerRef: 'cus_ABC' })
    expect(mockGetCustomerBalance).toHaveBeenNthCalledWith(2, { customerRef: 'cus_ABC' })
    expect(result).toEqual({ status: 'succeeded', creditsAdded: 150 })
  })

  it('soft-succeeds without creditsAdded when the poll budget exhausts', async () => {
    // Wallet never observes the delta — baseline AND every poll
    // return `credits: 100`. The helper should burn its entire
    // 7.5s budget and fall through to the legacy succeeded branch.
    mockGetCustomerBalance.mockResolvedValue({
      customerRef: 'cus_ABC',
      credits: 100,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const promise = processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000 + 4000)
    const result = await promise

    // 1 baseline + 4 polls.
    expect(mockGetCustomerBalance).toHaveBeenCalledTimes(5)
    expect(result).toEqual({ status: 'succeeded' })
  })

  it('does not poll getCustomerBalance on non-succeeded process statuses', async () => {
    mockGetCustomerBalance.mockResolvedValue({
      customerRef: 'cus_ABC',
      credits: 100,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })
    mockProcessPaymentIntent.mockResolvedValue({ status: 'failed' })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    // Baseline still captured, but no post-success polls.
    expect(mockGetCustomerBalance).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'failed' })
  })

  it('fails closed when processPaymentIntent returns an unknown or missing status', async () => {
    mockGetCustomerBalance.mockResolvedValue({
      customerRef: 'cus_ABC',
      credits: 100,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    })
    mockProcessPaymentIntent.mockResolvedValue({})

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    // Baseline is captured, but unknown status must not enter the
    // post-success polling path.
    expect(mockGetCustomerBalance).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'failed' })
  })

  it('falls back to legacy succeeded branch when baseline capture throws', async () => {
    // Transient backend hiccup on the baseline call. We still want
    // the topup to succeed (the PI itself processed fine) — just
    // without the optimistic `creditsAdded` hint.
    mockGetCustomerBalance.mockRejectedValueOnce(new Error('Baseline blew up'))
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    // Only the baseline call was made; no post-success polls fired
    // because `preCredits` stayed null.
    expect(mockGetCustomerBalance).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'succeeded' })
  })

  it('skips polling when the SolvaPay client lacks getCustomerBalance (legacy adapter)', async () => {
    // Override the factory mock to return a client without
    // `getCustomerBalance` — mirrors the shape of older custom
    // adapters that pre-date the wallet API.
    mockCreateSolvaPay.mockReturnValue({
      processPaymentIntent: mockProcessPaymentIntent,
    } as never)
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    expect(mockGetCustomerBalance).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'succeeded' })
  })

  it('ignores transient poll failures and continues with the next backoff slot', async () => {
    mockGetCustomerBalance
      .mockResolvedValueOnce({
        customerRef: 'cus_ABC',
        credits: 100,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 100,
        displayExchangeRate: 1,
      })
      // First post-success poll fails — second one observes the delta.
      .mockRejectedValueOnce(new Error('Transient'))
      .mockResolvedValueOnce({
        customerRef: 'cus_ABC',
        credits: 200,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 100,
        displayExchangeRate: 1,
      })
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const promise = processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    await vi.advanceTimersByTimeAsync(500 + 1000)
    const result = await promise

    expect(mockGetCustomerBalance).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ status: 'succeeded', creditsAdded: 100 })
  })
})

describe('attachBusinessDetailsCore', () => {
  const mockAttachBusinessDetails = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSolvaPay.mockReturnValue({
      attachBusinessDetails: mockAttachBusinessDetails,
    } as never)
  })

  it('rejects requests missing paymentIntentId with status 400', async () => {
    const result = await attachBusinessDetailsCore(fakeRequest(), {
      paymentIntentId: '',
      isBusiness: false,
    })
    expect(result).toEqual({
      error: 'paymentIntentId is required',
      status: 400,
    })
    expect(mockAttachBusinessDetails).not.toHaveBeenCalled()
  })

  it('rejects invalid business details with status 400', async () => {
    const result = await attachBusinessDetailsCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
      isBusiness: true,
      businessName: '',
      country: 'SE',
      taxId: 'SE123',
    })
    expect(result).toMatchObject({ status: 400 })
    expect(mockAttachBusinessDetails).not.toHaveBeenCalled()
  })

  it('forwards validated consumer details to solvaPay.attachBusinessDetails', async () => {
    mockAttachBusinessDetails.mockResolvedValue({
      taxBreakdown: {
        subtotal: 1000,
        taxAmount: 250,
        taxRate: 0.25,
        treatment: 'standard',
        total: 1250,
        currency: 'USD',
      },
    })

    const result = await attachBusinessDetailsCore(
      fakeRequest(),
      { paymentIntentId: 'pi_test_123', isBusiness: false },
      { solvaPay: { attachBusinessDetails: mockAttachBusinessDetails } as never },
    )

    expect(mockAttachBusinessDetails).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      isBusiness: false,
    })
    expect(result).toEqual({
      taxBreakdown: {
        subtotal: 1000,
        taxAmount: 250,
        taxRate: 0.25,
        treatment: 'standard',
        total: 1250,
        currency: 'USD',
      },
    })
  })

  it('forwards customer address fields on the consumer branch', async () => {
    mockAttachBusinessDetails.mockResolvedValue({
      taxBreakdown: {
        subtotal: 1000,
        taxAmount: 0,
        taxRate: 0,
        treatment: 'none',
        total: 1000,
        currency: 'USD',
      },
    })

    await attachBusinessDetailsCore(
      fakeRequest(),
      {
        paymentIntentId: 'pi_test_123',
        isBusiness: false,
        customerCountry: 'US',
        customerState: 'CA',
        customerPostalCode: '94103',
      },
      { solvaPay: { attachBusinessDetails: mockAttachBusinessDetails } as never },
    )

    expect(mockAttachBusinessDetails).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      isBusiness: false,
      customerCountry: 'US',
      customerState: 'CA',
      customerPostalCode: '94103',
    })
  })

  it('forwards validated business details including tax ID fields', async () => {
    mockAttachBusinessDetails.mockResolvedValue({
      taxBreakdown: {
        subtotal: 1000,
        taxAmount: 0,
        taxRate: 0,
        treatment: 'reverse_charge',
        total: 1000,
        currency: 'EUR',
      },
    })

    await attachBusinessDetailsCore(
      fakeRequest(),
      {
        paymentIntentId: 'pi_test_123',
        isBusiness: true,
        businessName: 'Acme AB',
        country: 'SE',
        taxId: 'SE556677889901',
      },
      { solvaPay: { attachBusinessDetails: mockAttachBusinessDetails } as never },
    )

    expect(mockAttachBusinessDetails).toHaveBeenCalledWith({
      paymentIntentId: 'pi_test_123',
      isBusiness: true,
      businessName: 'Acme AB',
      country: 'SE',
      customerCountry: 'SE',
      taxId: 'SE556677889901',
      taxIdType: 'eu_vat',
    })
  })
})

describe('createPaymentIntentCore / createTopupPaymentIntentCore — vault mode passthrough', () => {
  const mockSyncCustomer = vi.mocked(syncCustomerCore)
  const vaultResponse = {
    id: '66f1c2d3e4f5a6b7c8d9e0f1',
    captureMode: 'vault',
    vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
    amount: 1999,
    currency: 'USD',
    status: 'pending',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
  })

  it('forwards id, captureMode and vault so the browser can capture into the vault (no client secret)', async () => {
    const createPaymentIntent = vi.fn().mockResolvedValue(vaultResponse)
    mockCreateSolvaPay.mockReturnValue({ createPaymentIntent } as never)
    const result = await createPaymentIntentCore(fakeRequest(), { planRef: 'pln', productRef: 'prd' })
    expect(createPaymentIntent).toHaveBeenCalledTimes(1)
    expect(createPaymentIntent).toHaveBeenCalledWith({ customerRef: 'cus_ABC', planRef: 'pln', productRef: 'prd' })
    expect(result).toStrictEqual({
      id: '66f1c2d3e4f5a6b7c8d9e0f1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_ABC',
    })
  })

  it('does the same for top-ups', async () => {
    const createTopupPaymentIntent = vi.fn().mockResolvedValue(vaultResponse)
    mockCreateSolvaPay.mockReturnValue({ createTopupPaymentIntent } as never)
    const result = await createTopupPaymentIntentCore(fakeRequest(), { amount: 2500, currency: 'USD' })
    expect(createTopupPaymentIntent).toHaveBeenCalledTimes(1)
    expect(createTopupPaymentIntent).toHaveBeenCalledWith({
      customerRef: 'cus_ABC',
      amount: 2500,
      currency: 'USD',
      description: undefined,
    })
    expect(result).toStrictEqual({
      id: '66f1c2d3e4f5a6b7c8d9e0f1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      customerRef: 'cus_ABC',
    })
  })

  it('drops legacy browser-confirm fields and backend-only fields from the response', async () => {
    const createPaymentIntent = vi.fn().mockResolvedValue({
      ...vaultResponse,
      processorPaymentId: 'pi_y',
      clientSecret: 'cs_y',
      publishableKey: 'pk_y',
      accountId: 'acct_y',
      amount: 1999,
      currency: 'USD',
      status: 'requires_payment_method',
    })
    mockCreateSolvaPay.mockReturnValue({ createPaymentIntent } as never)
    const result = await createPaymentIntentCore(fakeRequest(), { planRef: 'pln', productRef: 'prd' })
    expect(result).toStrictEqual({
      id: '66f1c2d3e4f5a6b7c8d9e0f1',
      captureMode: 'vault',
      vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
      processorPaymentId: 'pi_y',
      customerRef: 'cus_ABC',
    })
  })
})

describe('createCaptureGrantCore', () => {
  const mockSyncCustomer = vi.mocked(syncCustomerCore)
  const mockHandleRouteError = vi.mocked(handleRouteError)
  const createCaptureGrant = vi.fn()
  const grant = {
    token: 'vgs-collect-token',
    tenantId: 'tntr4ol0cbq',
    environment: 'sandbox' as const,
    expiresAt: 1_800_000_000_000,
    scope: { paymentIntentId: 'pi_1' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    createCaptureGrant.mockResolvedValue(grant)
    mockCreateSolvaPay.mockReturnValue({ createCaptureGrant } as never)
  })

  it('rejects a missing paymentIntentId with 400 before touching auth or the backend', async () => {
    expect(await createCaptureGrantCore(fakeRequest(), { paymentIntentId: '' })).toStrictEqual({
      error: 'paymentIntentId is required',
      status: 400,
    })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
    expect(createCaptureGrant).not.toHaveBeenCalled()
  })

  it('requires the authenticated customer, then returns the grant verbatim', async () => {
    const request = fakeRequest()
    const result = await createCaptureGrantCore(request, { paymentIntentId: 'pi_1' })
    expect(mockSyncCustomer).toHaveBeenCalledTimes(1)
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, { solvaPay: undefined })
    expect(mockCreateSolvaPay).toHaveBeenCalledTimes(1)
    expect(mockCreateSolvaPay).toHaveBeenCalledWith()
    expect(createCaptureGrant).toHaveBeenCalledTimes(1)
    expect(createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' })
    expect(result).toStrictEqual(grant)
  })

  it('uses the provided solvaPay instance for both the customer sync and the grant', async () => {
    const provided = { createCaptureGrant: vi.fn().mockResolvedValue(grant) }
    const request = fakeRequest()
    const result = await createCaptureGrantCore(request, { paymentIntentId: 'pi_1' }, { solvaPay: provided as never })
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, { solvaPay: provided })
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
    expect(provided.createCaptureGrant).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' })
    expect(createCaptureGrant).not.toHaveBeenCalled()
    expect(result).toStrictEqual(grant)
  })

  it('propagates syncCustomerCore errors verbatim without requesting a grant', async () => {
    mockSyncCustomer.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    expect(await createCaptureGrantCore(fakeRequest(), { paymentIntentId: 'pi_1' })).toStrictEqual({
      error: 'Unauthorized',
      status: 401,
    })
    expect(createCaptureGrant).not.toHaveBeenCalled()
  })

  it('maps a backend failure through handleRouteError with the grant-specific message', async () => {
    const boom = new Error('grant limit reached')
    createCaptureGrant.mockRejectedValue(boom)
    expect(await createCaptureGrantCore(fakeRequest(), { paymentIntentId: 'pi_1' })).toStrictEqual({
      error: 'Could not start card capture',
      status: 500,
    })
    expect(mockHandleRouteError).toHaveBeenCalledTimes(1)
    expect(mockHandleRouteError).toHaveBeenCalledWith(boom, 'Create capture grant', 'Could not start card capture')
  })
})

describe('confirmPaymentCore', () => {
  const mockSyncCustomer = vi.mocked(syncCustomerCore)
  const mockHandleRouteError = vi.mocked(handleRouteError)
  const confirmPayment = vi.fn()
  const confirmed = { id: 'pi_1', processorPaymentId: 'pi_s', status: 'succeeded' as const }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncCustomer.mockResolvedValue('cus_ABC')
    confirmPayment.mockResolvedValue(confirmed)
    mockCreateSolvaPay.mockReturnValue({ confirmPayment } as never)
  })

  it('rejects a missing paymentIntentId with 400 before anything else', async () => {
    expect(await confirmPaymentCore(fakeRequest(), { paymentIntentId: '', cardId: 'CRD1' })).toStrictEqual({
      error: 'paymentIntentId is required',
      status: 400,
    })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
    expect(confirmPayment).not.toHaveBeenCalled()
  })

  it('rejects a body with neither cardId nor paymentMethodId with a distinct 400', async () => {
    expect(await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1' })).toStrictEqual({
      error: 'Provide cardId or paymentMethodId',
      status: 400,
    })
    expect(await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1', cardId: '', paymentMethodId: '' })).toStrictEqual({
      error: 'Provide cardId or paymentMethodId',
      status: 400,
    })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
    expect(confirmPayment).not.toHaveBeenCalled()
  })

  it('rejects a body with both cardId and paymentMethodId with a distinct 400', async () => {
    expect(
      await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1', cardId: 'c', paymentMethodId: 'pm' }),
    ).toStrictEqual({ error: 'Provide either cardId or paymentMethodId, not both', status: 400 })
    expect(mockSyncCustomer).not.toHaveBeenCalled()
    expect(confirmPayment).not.toHaveBeenCalled()
  })

  it('confirms with a captured card and forwards the return url, returning the payment verbatim', async () => {
    const request = fakeRequest()
    const result = await confirmPaymentCore(request, {
      paymentIntentId: 'pi_1',
      cardId: 'CRD1',
      returnUrl: 'https://x/r',
    })
    expect(mockSyncCustomer).toHaveBeenCalledTimes(1)
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, { solvaPay: undefined })
    expect(mockCreateSolvaPay).toHaveBeenCalledTimes(1)
    expect(confirmPayment).toHaveBeenCalledTimes(1)
    expect(confirmPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_1', cardId: 'CRD1', returnUrl: 'https://x/r' })
    expect(result).toStrictEqual(confirmed)
  })

  it('passes a 3DS redirect back untouched', async () => {
    const requiresAction = {
      id: 'pi_1',
      processorPaymentId: 'pi_s',
      status: 'requires_action' as const,
      redirectUrl: 'https://acs.bank.test/3ds/abc',
    }
    confirmPayment.mockResolvedValue(requiresAction)
    const result = await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1', cardId: 'CRD1', returnUrl: 'https://x/r' })
    expect(result).toStrictEqual(requiresAction)
  })

  it('confirms with a saved payment method and never sends a cardId', async () => {
    const result = await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1', paymentMethodId: 'pm_1' })
    expect(confirmPayment).toHaveBeenCalledTimes(1)
    expect(confirmPayment).toHaveBeenCalledWith({
      paymentIntentId: 'pi_1',
      paymentMethodId: 'pm_1',
      returnUrl: undefined,
    })
    expect(confirmPayment.mock.calls[0][0]).not.toHaveProperty('cardId')
    expect(result).toStrictEqual(confirmed)
  })

  it('uses the provided solvaPay instance instead of creating one', async () => {
    const provided = { confirmPayment: vi.fn().mockResolvedValue(confirmed) }
    const request = fakeRequest()
    const result = await confirmPaymentCore(request, { paymentIntentId: 'pi_1', cardId: 'CRD1' }, { solvaPay: provided as never })
    expect(mockSyncCustomer).toHaveBeenCalledWith(request, { solvaPay: provided })
    expect(mockCreateSolvaPay).not.toHaveBeenCalled()
    expect(provided.confirmPayment).toHaveBeenCalledWith({ paymentIntentId: 'pi_1', cardId: 'CRD1', returnUrl: undefined })
    expect(confirmPayment).not.toHaveBeenCalled()
    expect(result).toStrictEqual(confirmed)
  })

  it('propagates syncCustomerCore errors verbatim without confirming', async () => {
    mockSyncCustomer.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    expect(await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1', cardId: 'CRD1' })).toStrictEqual({
      error: 'Unauthorized',
      status: 401,
    })
    expect(confirmPayment).not.toHaveBeenCalled()
  })

  it('maps thrown errors through handleRouteError with the confirm-specific message', async () => {
    const boom = new Error('rail down')
    confirmPayment.mockRejectedValue(boom)
    expect(await confirmPaymentCore(fakeRequest(), { paymentIntentId: 'pi_1', cardId: 'c' })).toStrictEqual({
      error: 'Payment confirmation failed',
      status: 500,
    })
    expect(mockHandleRouteError).toHaveBeenCalledTimes(1)
    expect(mockHandleRouteError).toHaveBeenCalledWith(boom, 'Confirm payment', 'Payment confirmation failed')
  })
})
