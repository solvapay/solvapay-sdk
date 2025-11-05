/**
 * Checkout Helpers (Core)
 * 
 * Generic helpers for checkout session operations.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory';
import type { ErrorResult } from './types';
import { createSolvaPay } from '../factory';
import { handleRouteError, isErrorResult } from './error';
import { syncCustomerCore } from './customer';

/**
 * Create checkout session - core implementation
 * 
 * @param request - Standard Web API Request
 * @param body - Checkout session parameters
 * @param options - Configuration options
 * @returns Checkout session response or error result
 */
export async function createCheckoutSessionCore(
  request: Request,
  body: {
    agentRef: string;
    planRef?: string;
    returnUrl?: string;
  },
  options: {
    solvaPay?: SolvaPay;
    includeEmail?: boolean;
    includeName?: boolean;
    returnUrl?: string;
  } = {}
): Promise<{
  sessionId: string;
  checkoutUrl: string;
} | ErrorResult> {
  try {
    // Validate required parameters
    if (!body.agentRef) {
      return {
        error: 'Missing required parameter: agentRef is required',
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

    // Extract returnUrl from request if not provided
    // Priority: body.returnUrl > options.returnUrl > auto-extract from request origin
    let returnUrl = body.returnUrl || options.returnUrl;
    if (!returnUrl) {
      try {
        const url = new URL(request.url);
        returnUrl = url.origin;
      } catch (error) {
        // If URL parsing fails, continue without returnUrl
      }
    }

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay();

    // Call backend API to create checkout session
    const session = await solvaPay.createCheckoutSession({
      agentRef: body.agentRef,
      customerRef,
      planRef: body.planRef || undefined,
      returnUrl: returnUrl,
    });

    // Return the session details
    return {
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
    };
  } catch (error) {
    return handleRouteError(error, 'Create checkout session', 'Checkout session creation failed');
  }
}

/**
 * Create customer session - core implementation
 * 
 * @param request - Standard Web API Request
 * @param options - Configuration options
 * @returns Customer session response or error result
 */
export async function createCustomerSessionCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay;
    includeEmail?: boolean;
    includeName?: boolean;
  } = {}
): Promise<{
  sessionId: string;
  customerUrl: string;
} | ErrorResult> {
  try {
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

    // Call backend API to create customer session
    const session = await solvaPay.createCustomerSession({
      customerRef,
    });

    return session;
  } catch (error) {
    return handleRouteError(error, 'Create customer session', 'Customer session creation failed');
  }
}

