/**
 * Payment Helpers (Core)
 *
 * Generic helpers for payment operations.
 * Works with standard Web API Request (works everywhere).
 */

import {
  validateBusinessDetails,
  type BusinessDetailsInput,
  type TaxBreakdown,
} from '@solvapay/core'
import {
  attachBusinessDetailsValidationError,
  projectPaymentIntentResult,
  topupProcessNext,
  validateAttachBusinessDetailsParams,
  validateCreatePaymentIntentParams,
  validateProcessPaymentIntentParams,
  validateTopupPaymentIntentParams,
} from '../native-decisions'
import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import type { TopupProcessResult } from '../types/client'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

/**
 * Create a payment intent for a customer to purchase a plan.
 *
 * This is a framework-agnostic helper that:
 * 1. Extracts authenticated user from the request
 * 2. Syncs customer with SolvaPay backend
 * 3. Creates a payment intent for the specified plan
 *
 * The payment intent can then be confirmed on the client side.
 * After confirmation, use `processPaymentIntentCore()` to complete the purchase.
 *
 * @param request - Standard Web API Request object
 * @param body - Payment intent parameters
 * @param body.planRef - Plan reference to purchase (required)
 * @param body.productRef - Product reference (required)
 * @param options - Configuration options
 * @param options.solvaPay - Optional SolvaPay instance (creates new one if not provided)
 * @param options.includeEmail - Whether to include email in customer data (default: true)
 * @param options.includeName - Whether to include name in customer data (default: true)
 * @returns Payment intent response with client secret and customer reference, or error result
 *
 * @example
 * ```typescript
 * // In an API route handler
 * export async function POST(request: Request) {
 *   const body = await request.json();
 *   const result = await createPaymentIntentCore(request, body);
 *
 *   if (isErrorResult(result)) {
 *     return Response.json(result, { status: result.status });
 *   }
 *
 *   return Response.json(result);
 * }
 * ```
 *
 * @see {@link processPaymentIntentCore} for processing confirmed payments
 * @see {@link ErrorResult} for error handling
 * @since 1.0.0
 */
export async function createPaymentIntentCore(
  request: Request,
  body: {
    planRef: string
    productRef: string
    currency?: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<
  | {
      processorPaymentId: string
      clientSecret: string
      publishableKey: string
      accountId?: string
      customerRef: string
    }
  | ErrorResult
> {
  try {
    const validationError = validateCreatePaymentIntentParams(body.planRef, body.productRef)
    if (validationError) {
      return validationError
    }

    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const paymentIntent = await solvaPay.createPaymentIntent({
      productRef: body.productRef,
      planRef: body.planRef,
      customerRef,
      ...(body.currency && { currency: body.currency }),
    })

    return projectPaymentIntentResult(paymentIntent, customerRef)
  } catch (error) {
    return handleRouteError(error, 'Create payment intent', 'Payment intent creation failed')
  }
}

/**
 * Create a payment intent for a credit top-up.
 *
 * Unlike `createPaymentIntentCore`, this does not require a product or plan.
 * After client-side payment confirmation, credits are recorded via webhook —
 * no `processPaymentIntentCore` call is needed.
 *
 * @param request - Standard Web API Request object
 * @param body - Top-up parameters
 * @param body.amount - Amount in smallest currency unit (e.g. cents). Must be > 0
 * @param body.currency - ISO 4217 currency code (e.g. 'usd')
 * @param body.description - Optional description for the payment intent
 * @param options - Configuration options
 * @returns Payment intent response with client secret and customer reference, or error result
 */
export async function createTopupPaymentIntentCore(
  request: Request,
  body: {
    amount: number
    currency: string
    description?: string
    autoRecharge?: import('../types/client').AutoRechargeInput
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<
  | {
      processorPaymentId: string
      clientSecret: string
      publishableKey: string
      accountId?: string
      customerRef: string
    }
  | ErrorResult
> {
  try {
    const validationError = validateTopupPaymentIntentParams(body.amount, body.currency)
    if (validationError) {
      return validationError
    }

    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const paymentIntent = await solvaPay.createTopupPaymentIntent({
      customerRef,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      ...(body.autoRecharge ? { autoRecharge: body.autoRecharge } : {}),
    })

    return projectPaymentIntentResult(paymentIntent, customerRef)
  } catch (error) {
    return handleRouteError(
      error,
      'Create topup payment intent',
      'Topup payment intent creation failed',
    )
  }
}

/**
 * Process a payment intent after client-side payment confirmation.
 *
 * This helper processes a payment intent that has been confirmed on the client
 * side. It creates the purchase immediately, eliminating webhook delay.
 *
 * Call this after the client has confirmed the payment intent.
 *
 * @param request - Standard Web API Request object
 * @param body - Payment processing parameters
 * @param body.paymentIntentId - Processor payment ID from client confirmation (required)
 * @param body.productRef - Product reference (required)
 * @param body.planRef - Optional plan reference (if not in payment intent)
 * @param options - Configuration options
 * @param options.solvaPay - Optional SolvaPay instance (creates new one if not provided)
 * @returns Process payment result with purchase details, or error result
 *
 * @example
 * ```typescript
 * // In an API route handler
 * export async function POST(request: Request) {
 *   const body = await request.json();
 *   const result = await processPaymentIntentCore(request, body);
 *
 *   if (isErrorResult(result)) {
 *     return Response.json(result, { status: result.status });
 *   }
 *
 *   return Response.json(result);
 * }
 * ```
 *
 * @see {@link createPaymentIntentCore} for creating payment intents
 * @see {@link ErrorResult} for error handling
 * @since 1.0.0
 */
export async function processPaymentIntentCore(
  request: Request,
  body: {
    paymentIntentId: string
    productRef: string
    planRef?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<import('../types/client').ProcessPaymentResult | ErrorResult> {
  try {
    const validationError = validateProcessPaymentIntentParams(
      body.paymentIntentId,
      body.productRef,
    )
    if (validationError) {
      return validationError
    }

    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    const solvaPay = options.solvaPay || createSolvaPay()

    const result = await solvaPay.processPaymentIntent({
      paymentIntentId: body.paymentIntentId,
      productRef: body.productRef,
      customerRef,
      planRef: body.planRef,
    })

    return result
  } catch (error) {
    return handleRouteError(error, 'Process payment intent', 'Payment processing failed')
  }
}

/**
 * Attach business purchase details to a credit-topup payment intent and
 * retrieve the computed tax breakdown.
 *
 * Validates business fields client-side via `@solvapay/core` before
 * forwarding to the SolvaPay backend.
 */
export async function attachBusinessDetailsCore(
  request: Request,
  body: {
    paymentIntentId: string
    customerRef?: string
  } & BusinessDetailsInput,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<{ taxBreakdown: TaxBreakdown } | ErrorResult> {
  try {
    const paramError = validateAttachBusinessDetailsParams(body.paymentIntentId)
    if (paramError) {
      return paramError
    }

    const validation = validateBusinessDetails({
      isBusiness: body.isBusiness,
      businessName: body.businessName,
      country: body.country,
      customerCountry: body.customerCountry,
      customerName: body.customerName,
      taxId: body.taxId,
      taxIdType: body.taxIdType,
    })

    if (!validation.success) {
      const firstIssue = validation.error.issues[0]
      return attachBusinessDetailsValidationError(firstIssue?.message)
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (typeof solvaPay.attachBusinessDetails !== 'function') {
      return {
        error: 'attachBusinessDetails is not available on this SolvaPay client',
        status: 501,
      }
    }

    const details = validation.data
    const result = await solvaPay.attachBusinessDetails({
      paymentIntentId: body.paymentIntentId,
      ...(body.customerRef !== undefined && { customerRef: body.customerRef }),
      ...details,
    })

    return result
  } catch (error) {
    return handleRouteError(error, 'Attach business details', 'Failed to attach business details')
  }
}

/**
 * Process a credit-topup payment intent after client-side confirmation.
 *
 * Mirrors {@link processPaymentIntentCore} but for credit top-ups —
 * topups don't create a `PurchaseInfo` row, so the result is narrowed
 * to {@link TopupProcessResult} (no `type: 'recurring' | 'one-time'`
 * branches).
 *
 * Why this helper exists: `TopupForm.onSuccess` previously fired the
 * instant Stripe's `confirmPayment` resolved, racing the SolvaPay
 * webhook that books the credit. Symptom: the "X left" badge showed
 * `0` and the next chat send 402'd until the webhook caught up. This
 * helper routes through the backend's existing `/process` endpoint,
 * which polls the PI status server-side until `succeeded` (up to
 * ~10s).
 *
 * The Stripe webhook handler flips PI status BEFORE booking the credit
 * transaction (step 1 vs step 5 of `stripe-payment-webhook.handler.ts`).
 * Processor-fee lookups can push the credit-booking tail past the
 * backend `/process` poll's 2s post-success buffer. To close that
 * sub-second race the helper additionally:
 *
 *   1. Captures `preCredits` via `getCustomerBalance` before
 *      `processPaymentIntent` (this is the customer's wallet state
 *      immediately before the topup lands).
 *   2. After `/process` returns `succeeded`, polls `getCustomerBalance`
 *      on a `TOPUP_BALANCE_POLL_DELAYS_MS` backoff until
 *      `credits > preCredits`, then returns `creditsAdded = post - pre`.
 *
 * The React side uses `creditsAdded` to bump the in-memory balance
 * optimistically while the deterministic `refetchPurchase()` is still
 * in flight — eliminating the post-topup "0 left" badge race.
 *
 * Soft-success: if either the baseline capture fails (legacy
 * `SolvaPayClient` adapters without `getCustomerBalance`) or the poll
 * budget exhausts without observing the delta (rare — only when the
 * webhook is genuinely stalled), the helper still returns
 * `{ status: 'succeeded' }` without `creditsAdded`. Callers fall back
 * to refetch-only convergence.
 *
 * Implementation note: the backend's `/process` controller ignores
 * `productRef` / `planRef` on the request body (verified — the param
 * is named `_body: ProcessPaymentIntentDto`, and the service is invoked
 * with only `processorPaymentId` + `providerId`). The backend Zod
 * schema makes `productRef` optional precisely so this helper can
 * route topup PIs through the same `/process` route without inventing
 * a sentinel. Calling the same `solvaPay.processPaymentIntent` client
 * method keeps the SDK surface symmetric: `processPayment` for plans,
 * `processTopupPayment` for credit top-ups.
 *
 * Sequencing is owned by the Rust `topupProcessNext` driver; this
 * helper is the host loop (I/O + timers).
 *
 * @param request - Standard Web API Request object (used to extract the
 *   authenticated user / customer)
 * @param body - Topup processing parameters
 * @param body.paymentIntentId - Processor payment ID returned from the
 *   client `stripe.confirmPayment` call (required)
 * @param options - Configuration options
 * @param options.solvaPay - Optional SolvaPay instance (creates new one
 *   if not provided)
 * @returns Topup processing result, or error result
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const body = (await request.json()) as { paymentIntentId: string }
 *   const result = await processTopupPaymentIntentCore(request, body)
 *   if (isErrorResult(result)) {
 *     return Response.json(result, { status: result.status })
 *   }
 *   return Response.json(result)
 * }
 * ```
 */
export async function processTopupPaymentIntentCore(
  request: Request,
  body: {
    paymentIntentId: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<TopupProcessResult | ErrorResult> {
  try {
    let state: unknown = null
    let event: Record<string, unknown> = {
      kind: 'start',
      paymentIntentId: body.paymentIntentId,
    }
    const solvaPay = options.solvaPay || createSolvaPay()

    for (;;) {
      const out = topupProcessNext(state, event)
      if (isErrorResult(out)) {
        return out
      }
      if (typeof out !== 'object' || out === null || !('action' in out) || !('state' in out)) {
        throw new Error('topup_process_next returned unexpected value')
      }
      const result = out as {
        state: unknown
        action: {
          kind: string
          customerRef?: string
          paymentIntentId?: string
          ms?: number
          status?: string
          message?: string
          creditsAdded?: number
        }
      }
      state = result.state
      const action = result.action
      if (action.kind === 'syncCustomer') {
        const customerResult = await syncCustomerCore(request, {
          solvaPay: options.solvaPay,
        })
        if (isErrorResult(customerResult)) {
          return customerResult
        }
        event = {
          kind: 'syncCustomerResult',
          customerRef: customerResult,
          canGetBalance: typeof solvaPay.getCustomerBalance === 'function',
        }
        continue
      }
      if (action.kind === 'getCustomerBalance') {
        const customerRef = String(action.customerRef)
        try {
          const balance = await solvaPay.getCustomerBalance({ customerRef })
          event = { kind: 'balanceResult', credits: balance.credits }
        } catch {
          event = { kind: 'balanceResult' }
        }
        continue
      }
      if (action.kind === 'processPaymentIntent') {
        const processed = await solvaPay.processPaymentIntent({
          paymentIntentId: String(action.paymentIntentId),
          customerRef: String(action.customerRef),
        })
        const status = (processed as { status?: string }).status
        const message = (processed as { message?: string }).message
        event = {
          kind: 'processPaymentResult',
          ...(status !== undefined ? { status } : {}),
          ...(message !== undefined ? { message } : {}),
        }
        continue
      }
      if (action.kind === 'sleep') {
        await new Promise<void>(resolve => setTimeout(resolve, Number(action.ms)))
        event = { kind: 'sleepDone' }
        continue
      }
      if (action.kind === 'resolved') {
        return {
          status: action.status as TopupProcessResult['status'],
          ...(action.message !== undefined ? { message: action.message } : {}),
          ...(action.creditsAdded !== undefined ? { creditsAdded: action.creditsAdded } : {}),
        }
      }
      throw new Error(`topup_process_next unknown action kind: ${String(action.kind)}`)
    }
  } catch (error) {
    return handleRouteError(
      error,
      'Process topup payment intent',
      'Topup payment processing failed',
    )
  }
}
