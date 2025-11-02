/**
 * SolvaPay API Client Type Definitions
 * 
 * Types related to the SolvaPay API client and backend communication.
 */

import type { components } from './generated';

/**
 * Extended LimitResponse with plan field
 */
export type LimitResponseWithPlan = components['schemas']['LimitResponse'] & { plan: string };

/**
 * Extended CustomerResponse with proper field mapping
 */
export type CustomerResponseMapped = {
  customerRef: string;
  email?: string;
  name?: string;
  externalRef?: string;
  plan?: string;
  subscriptions?: components['schemas']['SubscriptionInfo'][];
};

/**
 * Purchase information returned from payment processing
 */
export interface PurchaseInfo {
  reference: string;
  productRef?: string;
  amount: number;
  currency: string;
  creditsAdded?: number;
  completedAt: string;
}

/**
 * Result from processing a payment intent
 */
export interface ProcessPaymentResult {
  type: 'subscription' | 'purchase';
  subscription?: components['schemas']['SubscriptionInfo'];
  purchase?: PurchaseInfo;
  status: 'completed';
}

/**
 * SolvaPay API Client Interface
 * 
 * This interface defines the contract for communicating with the SolvaPay backend.
 * Uses auto-generated types from the OpenAPI specification.
 * You can provide your own implementation or use the default createSolvaPayClient().
 */
export interface SolvaPayClient {
  // POST: /v1/sdk/limits
  checkLimits(
    params: components['schemas']['CheckLimitRequest']
  ): Promise<LimitResponseWithPlan>;

  // POST: /v1/sdk/usages
  trackUsage(
    params: components['schemas']['UsageEvent'] & { planRef: string }
  ): Promise<void>;

  // POST: /v1/sdk/customers
  createCustomer?(
    params: components['schemas']['CreateCustomerRequest']
  ): Promise<{ customerRef: string }>;

  // GET: /v1/sdk/customers/{reference}
  getCustomer?(params: {
    customerRef: string;
  }): Promise<CustomerResponseMapped>;

  // GET: /v1/sdk/customers?externalRef={externalRef}
  getCustomerByExternalRef?(params: {
    externalRef: string;
  }): Promise<CustomerResponseMapped>;

  // Management methods (primarily for integration tests)
  
  // GET: /v1/sdk/agents
  listAgents?(): Promise<Array<{
    reference: string;
    name: string;
    description?: string;
  }>>;
  
  // POST: /v1/sdk/agents
  createAgent?(
    params: components['schemas']['CreateAgentRequest']
  ): Promise<{
    reference: string;
    name: string;
  }>;

  // DELETE: /v1/sdk/agents/{agentRef}
  deleteAgent?(agentRef: string): Promise<void>;

  // GET: /v1/sdk/agents/{agentRef}/plans
  listPlans?(agentRef: string): Promise<Array<{
    reference: string;
    name: string;
    isFreeTier?: boolean;
    freeUnits?: number;
    description?: string;
  }>>;

  // POST: /v1/sdk/agents/{agentRef}/plans
  createPlan?(
    params: components['schemas']['CreatePlanRequest'] & { agentRef: string }
  ): Promise<{
    reference: string;
    name: string;
  }>;

  // DELETE: /v1/sdk/agents/{agentRef}/plans/{planRef}
  deletePlan?(agentRef: string, planRef: string): Promise<void>;

  // POST: /v1/sdk/payment-intents
  createPaymentIntent?(params: {
    agentRef: string;
    planRef: string;
    customerRef: string;
    idempotencyKey?: string;
  }): Promise<{
    id: string;
    clientSecret: string;
    publishableKey: string;
    accountId?: string;
  }>;

  // POST: /v1/sdk/subscriptions/{subscriptionRef}/cancel
  cancelSubscription?(params: {
    subscriptionRef: string;
    reason?: string;
  }): Promise<components['schemas']['SubscriptionResponse']>;

  // POST: /v1/sdk/payment-intents/{paymentIntentId}/process
  processPayment?(params: {
    paymentIntentId: string;
    agentRef: string;
    customerRef: string;
    planRef?: string;
  }): Promise<ProcessPaymentResult>;
}

