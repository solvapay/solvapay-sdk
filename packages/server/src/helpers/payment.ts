/**
 * Payment Helpers (Core)
 * 
 * Generic helpers for payment operations.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory';
import type { ErrorResult } from './types';
import { createSolvaPay } from '../factory';
import { handleRouteError, isErrorResult } from './error';
import { syncCustomerCore } from './customer';

/**
 * Create payment intent - core implementation
 * 
 * @param request - Standard Web API Request
 * @param body - Payment intent parameters
 * @param options - Configuration options
 * @returns Payment intent response or error result
 */
export async function createPaymentIntentCore(
  request: Request,
  body: {
    planRef: string;
    agentRef: string;
  },
  options: {
    solvaPay?: SolvaPay;
    includeEmail?: boolean;
    includeName?: boolean;
  } = {}
): Promise<{
  id: string;
  clientSecret: string;
  publishableKey: string;
  accountId?: string;
  customerRef: string;
} | ErrorResult> {
  try {
    // Validate required parameters
    if (!body.planRef || !body.agentRef) {
      return {
        error: 'Missing required parameters: planRef and agentRef are required',
        status: 400,
      };
    }

    // Sync customer first
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    });

    if (isErrorResult(customerResult)) {
      return customerResult;
    }

    const customerRef = customerResult;

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay();

    // Create payment intent using the SDK
    const paymentIntent = await solvaPay.createPaymentIntent({
      agentRef: body.agentRef,
      planRef: body.planRef,
      customerRef,
    });

    // Return the payment intent details
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.clientSecret,
      publishableKey: paymentIntent.publishableKey,
      accountId: paymentIntent.accountId,
      customerRef, // Return the backend customer reference
    };
  } catch (error) {
    return handleRouteError(error, 'Create payment intent', 'Payment intent creation failed');
  }
}

/**
 * Process payment - core implementation
 * 
 * @param request - Standard Web API Request
 * @param body - Payment processing parameters
 * @param options - Configuration options
 * @returns Process payment result or error result
 */
export async function processPaymentCore(
  request: Request,
  body: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  },
  options: {
    solvaPay?: SolvaPay;
  } = {}
): Promise<import('../types/client').ProcessPaymentResult | ErrorResult> {
  try {
    // Validate required parameters
    if (!body.paymentIntentId || !body.agentRef) {
      return {
        error: 'paymentIntentId and agentRef are required',
        status: 400,
      };
    }

    // Sync customer first
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
    });

    if (isErrorResult(customerResult)) {
      return customerResult;
    }

    const customerRef = customerResult;

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay();

    // Call SDK method to process the already-confirmed payment
    const result = await solvaPay.processPayment({
      paymentIntentId: body.paymentIntentId,
      agentRef: body.agentRef,
      customerRef,
      planRef: body.planRef,
    });

    return result;
  } catch (error) {
    return handleRouteError(error, 'Process payment', 'Payment processing failed');
  }
}

