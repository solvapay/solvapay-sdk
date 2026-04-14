/**
 * Payment Helpers (Core)
 *
 * Generic helpers for payment operations.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
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
    if (!body.planRef || !body.productRef) {
      return {
        error: 'Missing required parameters: planRef and productRef are required',
        status: 400,
      }
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
    })

    return {
      processorPaymentId: paymentIntent.processorPaymentId,
      clientSecret: paymentIntent.clientSecret,
      publishableKey: paymentIntent.publishableKey,
      accountId: paymentIntent.accountId,
      customerRef,
    }
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
    if (!body.amount || body.amount <= 0) {
      return {
        error: 'Missing or invalid amount: must be a positive number',
        status: 400,
      }
    }

    if (!body.currency) {
      return {
        error: 'Missing required parameter: currency',
        status: 400,
      }
    }

    if (body.currency !== body.currency.toUpperCase()) {
      return {
        error: `Invalid currency "${body.currency}": must be an uppercase ISO 4217 code (e.g. "USD", "EUR")`,
        status: 400,
      }
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
    })

    return {
      processorPaymentId: paymentIntent.processorPaymentId,
      clientSecret: paymentIntent.clientSecret,
      publishableKey: paymentIntent.publishableKey,
      accountId: paymentIntent.accountId,
      customerRef,
    }
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
    if (!body.paymentIntentId || !body.productRef) {
      return {
        error: 'paymentIntentId and productRef are required',
        status: 400,
      }
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
