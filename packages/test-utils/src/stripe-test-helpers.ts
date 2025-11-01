/**
 * Stripe Test Helpers for Payment Integration Tests
 * 
 * These utilities help test payment flows using real Stripe test mode.
 * They wrap the backend SDK for payment intent creation and provide
 * helpers for confirming payments and waiting for webhook processing.
 */

import type { SolvaPayClient } from '@solvapay/server';
import { testLog } from './test-logger';

/**
 * Stripe test card payment methods
 * @see https://stripe.com/docs/testing#cards
 */
export const STRIPE_TEST_CARDS = {
  /** Visa - Succeeds and immediately processes */
  VISA: 'pm_card_visa',
  /** Visa (debit) - Succeeds and immediately processes */
  VISA_DEBIT: 'pm_card_visa_debit',
  /** Mastercard - Succeeds and immediately processes */
  MASTERCARD: 'pm_card_mastercard',
  /** American Express - Succeeds and immediately processes */
  AMEX: 'pm_card_amex',
  /** Charge is declined with a card_declined code */
  DECLINED: 'pm_card_chargeDeclined',
  /** Charge is declined with an insufficient_funds code */
  INSUFFICIENT_FUNDS: 'pm_card_chargeDeclinedInsufficientFunds',
} as const;

/**
 * Create a payment intent via backend SDK
 * 
 * @param apiClient - SolvaPay API client instance
 * @param agentRef - Reference to the agent
 * @param planRef - Reference to the plan to purchase
 * @param customerRef - Reference to the customer making the payment
 * @returns Payment intent with clientSecret, publishableKey, and stripeAccountId
 * 
 * @example
 * ```typescript
 * const paymentIntent = await createTestPaymentIntent(apiClient, 'agt_abc123', 'pln_abc123', 'cust_xyz789');
 * console.log(paymentIntent.clientSecret); // pi_xxx_secret_yyy
 * ```
 */
export async function createTestPaymentIntent(
  apiClient: SolvaPayClient,
  agentRef: string,
  planRef: string,
  customerRef: string
): Promise<{
  id: string;
  clientSecret: string;
  publishableKey: string;
  accountId?: string;
  stripeAccountId?: string; // Add this for Stripe Connect
}> {
  if (!apiClient.createPaymentIntent) {
    throw new Error('API client does not support createPaymentIntent method');
  }

  const idempotencyKey = `test-payment-${planRef}-${Date.now()}`;
  const result = await apiClient.createPaymentIntent({ agentRef, planRef, customerRef, idempotencyKey });
  
  // Map accountId to stripeAccountId for consistency
  return {
    ...result,
    stripeAccountId: result.accountId
  };
}

/**
 * Confirm a payment intent programmatically using Stripe SDK with a test card
 * 
 * @param stripe - Stripe client instance (from 'stripe' package)
 * @param clientSecret - Payment intent client secret from backend
 * @param paymentMethod - Stripe test payment method (default: pm_card_visa)
 * @param stripeAccountId - Optional Stripe Connect account ID (for connected accounts)
 * @returns Confirmed payment intent
 * 
 * @example
 * ```typescript
 * import Stripe from 'stripe';
 * const stripe = new Stripe(process.env.STRIPE_TEST_SECRET_KEY);
 * 
 * const result = await confirmPaymentWithTestCard(
 *   stripe,
 *   paymentIntent.clientSecret,
 *   STRIPE_TEST_CARDS.VISA,
 *   paymentIntent.stripeAccountId // Optional for Stripe Connect
 * );
 * ```
 */
export async function confirmPaymentWithTestCard(
  stripe: any, // Stripe instance
  clientSecret: string,
  paymentMethod: string = STRIPE_TEST_CARDS.VISA,
  stripeAccountId?: string
): Promise<any> {
  testLog.info(`💳 Confirming payment with test card: ${paymentMethod}`);
  
  // Extract payment intent ID from client secret (format: pi_xxx_secret_yyy)
  const paymentIntentId = clientSecret.split('_secret_')[0];
  testLog.info(`   Payment Intent ID: ${paymentIntentId}`);
  if (stripeAccountId) {
    testLog.info(`   Stripe Account: ${stripeAccountId}`);
  }
  
  // For Stripe Connect, we need to specify the account
  const options: any = {
    payment_method: paymentMethod,
  };
  
  // Add Stripe account header if using Stripe Connect
  const requestOptions = stripeAccountId 
    ? { stripeAccount: stripeAccountId }
    : undefined;
  
  const result = await stripe.paymentIntents.confirm(
    paymentIntentId,
    options,
    requestOptions
  );
  
  testLog.info(`✅ Payment confirmed:`, {
    id: result.id,
    status: result.status,
    amount: result.amount,
    currency: result.currency,
  });
  
  return result;
}

/**
 * Poll backend API until webhook processing completes and credits are added
 * 
 * This helper waits for the Stripe webhook to be processed by the backend
 * and for the customer's usage credits to be updated.
 * 
 * @param apiClient - SolvaPay API client instance
 * @param customerRef - Customer reference to check
 * @param agentRef - Agent reference to check limits for
 * @param planRef - Plan reference (unused, kept for backward compatibility)
 * @param expectedUnits - Minimum expected remaining units after payment
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns Limits check result once credits are available
 * @throws Error if timeout is reached before credits appear
 * 
 * @example
 * ```typescript
 * // Wait for 100 units to be added
 * const limits = await waitForWebhookProcessing(
 *   apiClient,
 *   'customer_123',
 *   'agent_123',
 *   'plan_123', // Not used, but kept for backward compatibility
 *   100,
 *   15000 // 15 second timeout
 * );
 * 
 * console.log(`Credits available: ${limits.remaining}`);
 * ```
 */
export async function waitForWebhookProcessing(
  apiClient: SolvaPayClient,
  customerRef: string,
  agentRef: string,
  planRef: string,
  expectedUnits: number,
  timeout: number = 10000
): Promise<{
  withinLimits: boolean;
  remaining: number;
  plan: string;
  checkoutUrl?: string;
}> {
  const startTime = Date.now();
  let attempts = 0;
  
  testLog.info(`⏳ Waiting for webhook processing (expecting ${expectedUnits} units)...`);
  
  while (Date.now() - startTime < timeout) {
    attempts++;
    
    try {
      const limits = await apiClient.checkLimits({
        customerRef: customerRef,
        agentRef: agentRef
      });
      
      testLog.debug(`  Attempt ${attempts}: remaining=${limits.remaining}, target=${expectedUnits}`);
      
      if (limits.remaining >= expectedUnits) {
        testLog.info(`✅ Webhook processed successfully after ${attempts} attempts (${Date.now() - startTime}ms)`);
        return limits;
      }
    } catch (error) {
      testLog.debug(`  Attempt ${attempts}: Error checking limits - ${error instanceof Error ? error.message : error}`);
    }
    
    // Wait 500ms between polls
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error(
    `Webhook processing timeout after ${timeout}ms (${attempts} attempts). ` +
    `Expected ${expectedUnits} units but webhook did not complete.`
  );
}

/**
 * Wait for a payment intent to reach a specific status
 * 
 * @param stripe - Stripe client instance
 * @param paymentIntentId - Payment intent ID to check
 * @param expectedStatus - Status to wait for (e.g., 'succeeded')
 * @param timeout - Maximum time to wait in milliseconds (default: 10000)
 * @returns Payment intent once it reaches the expected status
 */
export async function waitForPaymentIntentStatus(
  stripe: any,
  paymentIntentId: string,
  expectedStatus: string,
  timeout: number = 10000
): Promise<any> {
  const startTime = Date.now();
  let attempts = 0;
  
  testLog.info(`⏳ Waiting for payment intent ${paymentIntentId} to reach status: ${expectedStatus}...`);
  
  while (Date.now() - startTime < timeout) {
    attempts++;
    
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    testLog.debug(`  Attempt ${attempts}: status=${paymentIntent.status}`);
    
    if (paymentIntent.status === expectedStatus) {
      testLog.info(`✅ Payment intent reached ${expectedStatus} after ${attempts} attempts`);
      return paymentIntent;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error(
    `Payment intent status timeout after ${timeout}ms. ` +
    `Expected ${expectedStatus} but status did not update.`
  );
}

