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
 * Create a Stripe payment intent for a customer to subscribe to a plan.
 *
 * This is a framework-agnostic helper that:
 * 1. Extracts authenticated user from the request
 * 2. Syncs customer with SolvaPay backend
 * 3. Creates a payment intent for the specified plan
 *
 * The payment intent can then be confirmed on the client side using Stripe.js.
 * After confirmation, use `processPaymentCore()` to complete the subscription.
 *
 * @param request - Standard Web API Request object
 * @param body - Payment intent parameters
 * @param body.planRef - Plan reference to subscribe to (required)
 * @param body.agentRef - Agent reference (required)
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
 * @see {@link processPaymentCore} for processing confirmed payments
 * @see {@link ErrorResult} for error handling
 * @since 1.0.0
 */
export async function createPaymentIntentCore(
  request: Request,
  body: {
    planRef: string
    agentRef: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<
  | {
      id: string
      clientSecret: string
      publishableKey: string
      accountId?: string
      customerRef: string
    }
  | ErrorResult
> {
  try {
    // Validate required parameters
    if (!body.planRef || !body.agentRef) {
      return {
        error: 'Missing required parameters: planRef and agentRef are required',
        status: 400,
      }
    }

    // Sync customer first
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay()

    // Create payment intent using the SDK
    const paymentIntent = await solvaPay.createPaymentIntent({
      agentRef: body.agentRef,
      planRef: body.planRef,
      customerRef,
    })

    // Return the payment intent details
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.clientSecret,
      publishableKey: paymentIntent.publishableKey,
      accountId: paymentIntent.accountId,
      customerRef, // Return the backend customer reference
    }
  } catch (error) {
    return handleRouteError(error, 'Create payment intent', 'Payment intent creation failed')
  }
}

/**
 * Process a payment intent after client-side Stripe confirmation.
 *
 * This helper processes a payment intent that has been confirmed on the client
 * side using Stripe.js. It creates the subscription or purchase immediately,
 * eliminating webhook delay.
 *
 * Call this after the client has confirmed the payment intent with Stripe.js.
 *
 * @param request - Standard Web API Request object
 * @param body - Payment processing parameters
 * @param body.paymentIntentId - Stripe payment intent ID from client confirmation (required)
 * @param body.agentRef - Agent reference (required)
 * @param body.planRef - Optional plan reference (if not in payment intent)
 * @param options - Configuration options
 * @param options.solvaPay - Optional SolvaPay instance (creates new one if not provided)
 * @returns Process payment result with subscription details, or error result
 *
 * @example
 * ```typescript
 * // In an API route handler
 * export async function POST(request: Request) {
 *   const body = await request.json();
 *   const result = await processPaymentCore(request, body);
 *
 *   if (isErrorResult(result)) {
 *     return Response.json(result, { status: result.status });
 *   }
 *
 *   if (result.success) {
 *     console.log('Subscription created:', result.subscriptionRef);
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
export async function processPaymentCore(
  request: Request,
  body: {
    paymentIntentId: string
    agentRef: string
    planRef?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<import('../types/client').ProcessPaymentResult | ErrorResult> {
  try {
    // Validate required parameters
    if (!body.paymentIntentId || !body.agentRef) {
      return {
        error: 'paymentIntentId and agentRef are required',
        status: 400,
      }
    }

    // Sync customer first
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay()

    // Call SDK method to process the already-confirmed payment
    const result = await solvaPay.processPayment({
      paymentIntentId: body.paymentIntentId,
      agentRef: body.agentRef,
      customerRef,
      planRef: body.planRef,
    })

    return result
  } catch (error) {
    return handleRouteError(error, 'Process payment', 'Payment processing failed')
  }
}
