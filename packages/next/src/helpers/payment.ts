/**
 * Next.js Payment Helpers
 * 
 * Next.js-specific wrappers for payment helpers.
 */

import { NextResponse } from 'next/server';
import type { SolvaPay } from '@solvapay/server';
import {
  createPaymentIntentCore,
  processPaymentCore,
  type ErrorResult,
  isErrorResult,
} from '@solvapay/server';
import { clearSubscriptionCache } from '../cache';
import { getAuthenticatedUserCore } from '@solvapay/server';

/**
 * Create payment intent - Next.js wrapper
 * 
 * @param request - Next.js request object
 * @param body - Payment intent parameters
 * @param options - Configuration options
 * @returns Payment intent response or NextResponse error
 */
export async function createPaymentIntent(
  request: globalThis.Request,
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
} | NextResponse> {
  const result = await createPaymentIntentCore(request, body, options);
  
  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }
  
  // Clear subscription cache to ensure fresh data after payment intent creation
  try {
    const userResult = await getAuthenticatedUserCore(request);
    if (!isErrorResult(userResult)) {
      clearSubscriptionCache(userResult.userId);
    }
  } catch {
    // Ignore errors in cache clearing
  }
  
  return result;
}

/**
 * Process payment - Next.js wrapper
 * 
 * @param request - Next.js request object
 * @param body - Payment processing parameters
 * @param options - Configuration options
 * @returns Process payment result or NextResponse error
 */
export async function processPayment(
  request: globalThis.Request,
  body: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  },
  options: {
    solvaPay?: SolvaPay;
  } = {}
): Promise<import('@solvapay/server').ProcessPaymentResult | NextResponse> {
  const result = await processPaymentCore(request, body, options);
  
  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }
  
  // Clear subscription cache to ensure fresh data on next fetch
  try {
    const userResult = await getAuthenticatedUserCore(request);
    if (!isErrorResult(userResult)) {
      clearSubscriptionCache(userResult.userId);
    }
  } catch {
    // Ignore errors in cache clearing
  }
  
  return result;
}

