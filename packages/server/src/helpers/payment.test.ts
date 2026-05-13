import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../factory', () => ({
  createSolvaPay: vi.fn(),
}))

vi.mock('./auth', () => ({
  getAuthenticatedUserCore: vi.fn(),
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
import { getAuthenticatedUserCore } from './auth'
import { processTopupPaymentIntentCore } from './payment'

const mockGetAuth = vi.mocked(getAuthenticatedUserCore)
const mockCreateSolvaPay = vi.mocked(createSolvaPay)

function fakeRequest() {
  return new Request('http://localhost/api/process-topup-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('processTopupPaymentIntentCore', () => {
  const mockEnsureCustomer = vi.fn()
  const mockProcessPaymentIntent = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureCustomer.mockResolvedValue('cus_ABC')
    mockCreateSolvaPay.mockReturnValue({
      ensureCustomer: mockEnsureCustomer,
      processPaymentIntent: mockProcessPaymentIntent,
    } as never)
    mockGetAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'user@example.com',
      name: 'Test User',
    })
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

  it('propagates auth errors verbatim', async () => {
    mockGetAuth.mockResolvedValue({
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

  it('forwards paymentIntentId to solvaPay.processPaymentIntent with the authenticated customerRef', async () => {
    mockProcessPaymentIntent.mockResolvedValue({ status: 'succeeded' })

    const result = await processTopupPaymentIntentCore(fakeRequest(), {
      paymentIntentId: 'pi_test_123',
    })

    expect(mockEnsureCustomer).toHaveBeenCalledWith('user_123', 'user_123', {
      email: 'user@example.com',
      name: 'Test User',
    })
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
      ensureCustomer: mockEnsureCustomer,
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
// terminal state, but the Stripe webhook handler may still be writing
// the TOPUP credit transaction (step 5 of
// stripe-payment-webhook.handler.ts). The helper captures a balance
// baseline before `processPaymentIntent` and polls post-success on a
// backoff until the wallet observes the delta, then returns
// `creditsAdded` so the React side can bump the in-memory balance
// before its deterministic `refetchPurchase()` lands.
// ------------------------------------------------------------------

describe('processTopupPaymentIntentCore — post-success balance polling', () => {
  const mockEnsureCustomer = vi.fn()
  const mockProcessPaymentIntent = vi.fn()
  const mockGetCustomerBalance = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    mockEnsureCustomer.mockReset().mockResolvedValue('cus_ABC')
    mockProcessPaymentIntent.mockReset()
    mockGetCustomerBalance.mockReset()
    mockCreateSolvaPay.mockReset().mockReturnValue({
      ensureCustomer: mockEnsureCustomer,
      processPaymentIntent: mockProcessPaymentIntent,
      getCustomerBalance: mockGetCustomerBalance,
    } as never)
    mockGetAuth.mockReset().mockResolvedValue({
      userId: 'user_123',
      email: 'user@example.com',
      name: 'Test User',
    })
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
      ensureCustomer: mockEnsureCustomer,
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
