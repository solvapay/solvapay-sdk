/**
 * SolvaPay Server SDK - API Client
 * 
 * This module provides the API client implementation for communicating with
 * the SolvaPay backend. The client handles all HTTP requests for paywall
 * protection, usage tracking, and resource management.
 */

import { SolvaPayError } from "@solvapay/core";
import type { SolvaPayClient } from "./types";

/**
 * Configuration options for creating a SolvaPay API client
 */
export type ServerClientOptions = {
  /**
   * Your SolvaPay API key (required)
   */
  apiKey: string;
  
  /**
   * Base URL for the SolvaPay API (optional)
   * Defaults to https://api-dev.solvapay.com
   */
  apiBaseUrl?: string;
};

/**
 * Creates a SolvaPay API client that implements the full SolvaPayClient
 * for server-side paywall and usage tracking operations.
 * 
 * @param opts - Configuration options including API key and optional base URL
 * @returns A fully configured SolvaPayClient instance
 * @throws {SolvaPayError} If API key is missing
 * 
 * @example
 * ```typescript
 * const client = createSolvaPayClient({
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY!,
 *   apiBaseUrl: 'https://api.solvapay.com' // optional
 * });
 * ```
 */
export function createSolvaPayClient(opts: ServerClientOptions): SolvaPayClient {
  const base = opts.apiBaseUrl ?? "https://api-dev.solvapay.com";
  if (!opts.apiKey) throw new SolvaPayError("Missing apiKey");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${opts.apiKey}`,
  };

  // Enable debug logging via environment variable (same pattern as paywall)
  const debug = process.env.SOLVAPAY_DEBUG === 'true';
  const log = (...args: any[]) => {
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  };

  log(`🔌 SolvaPay API Client initialized`);
  log(`   Backend URL: ${base}`);
  log(`   API Key: ${opts.apiKey.substring(0, 10)}...`);

  return {
    // POST: /v1/sdk/limits
    async checkLimits(params) {
      const url = `${base}/v1/sdk/limits`;
      log(`📡 API Request: POST ${url}`);
      log(`   Params:`, JSON.stringify(params, null, 2));
      
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Check limits failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      log(`🔍 DEBUG - checkLimits breakdown:`);
      log(`   - withinLimits: ${result.withinLimits}`);
      log(`   - remaining: ${result.remaining}`);
      log(`   - plan: ${result.plan || 'N/A'}`);
      log(`   - checkoutUrl: ${result.checkoutUrl || 'N/A'}`);
      log(`   - Full response keys:`, Object.keys(result));
      return result;
    },

    // POST: /v1/sdk/usages
    async trackUsage(params) {
      const url = `${base}/v1/sdk/usages`;
      log(`📡 API Request: POST ${url}`);
      log(`   Params:`, JSON.stringify(params, null, 2));
      
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Track usage failed (${res.status}): ${error}`);
      }
      
      log(`✅ Usage tracked successfully`);
    },

    // POST: /v1/sdk/customers
    async createCustomer(params) {
      const url = `${base}/v1/sdk/customers`;
      log(`📡 API Request: POST ${url}`);
      log(`   Params:`, JSON.stringify(params, null, 2));
      
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Create customer failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      log(`🔍 DEBUG - createCustomer response:`);
      log(`   - reference/customerRef: ${result.reference || result.customerRef}`);
      log(`   - Has plan info: ${result.plan ? 'YES' : 'NO'}`);
      log(`   - Has subscription info: ${result.subscription ? 'YES' : 'NO'}`);
      log(`   - Full response keys:`, Object.keys(result));
      return result;
    },

    // GET: /v1/sdk/customers/{reference}
    async getCustomer(params) {
      const url = `${base}/v1/sdk/customers/${params.customerRef}`;
      log(`📡 API Request: GET ${url}`);
      
      const res = await fetch(url, {
        method: "GET",
        headers,
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Get customer failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      return result;
    },

    // Management methods (primarily for integration tests)

    // GET: /v1/sdk/agents
    async listAgents() {
      const url = `${base}/v1/sdk/agents`;
      log(`📡 API Request: GET ${url}`);
      
      const res = await fetch(url, {
        method: "GET",
        headers,
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`List agents failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      // Handle both direct array and wrapped object formats
      const agents = Array.isArray(result) ? result : (result.agents || []);
      
      // Unwrap data field if present
      return agents.map((agent: any) => ({  
        ...agent,
        ...(agent.data || {})
      }));
    },

    // POST: /v1/sdk/agents
    async createAgent(params) {
      const url = `${base}/v1/sdk/agents`;
      log(`📡 API Request: POST ${url}`);
      log(`   Params:`, JSON.stringify(params, null, 2));
      
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Create agent failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      return result;
    },

    // DELETE: /v1/sdk/agents/{agentRef}
    async deleteAgent(agentRef) {
      const url = `${base}/v1/sdk/agents/${agentRef}`;
      log(`📡 API Request: DELETE ${url}`);
      
      const res = await fetch(url, {
        method: "DELETE",
        headers,
      });
      
      if (!res.ok && res.status !== 404) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Delete agent failed (${res.status}): ${error}`);
      }
      
      log(`✅ Agent deleted successfully`);
    },

    // GET: /v1/sdk/agents/{agentRef}/plans
    async listPlans(agentRef) {
      const url = `${base}/v1/sdk/agents/${agentRef}/plans`;
      log(`📡 API Request: GET ${url}`);
      
      const res = await fetch(url, {
        method: "GET",
        headers,
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`List plans failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      // Handle both direct array and wrapped object formats
      const plans = Array.isArray(result) ? result : (result.plans || []);
      
      // Unwrap data field if present
      return plans.map((plan: any) => ({
        ...plan,
        ...(plan.data || {})
      }));
    },

    // POST: /v1/sdk/agents/{agentRef}/plans
    async createPlan(params) {
      const url = `${base}/v1/sdk/agents/${params.agentRef}/plans`;
      log(`📡 API Request: POST ${url}`);
      log(`   Params:`, JSON.stringify(params, null, 2));
      
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Create plan failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ API Response:`, JSON.stringify(result, null, 2));
      return result;
    },

    // DELETE: /v1/sdk/agents/{agentRef}/plans/{planRef}
    async deletePlan(agentRef, planRef) {
      const url = `${base}/v1/sdk/agents/${agentRef}/plans/${planRef}`;
      log(`📡 API Request: DELETE ${url}`);
      
      const res = await fetch(url, {
        method: "DELETE",
        headers,
      });
      
      if (!res.ok && res.status !== 404) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Delete plan failed (${res.status}): ${error}`);
      }
      
      log(`✅ Plan deleted successfully`);
    },

    // POST: /payment-intents
    async createPaymentIntent(params) {
      const idempotencyKey = params.idempotencyKey || 
        `payment-${params.planRef}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const url = `${base}/v1/sdk/payment-intents`;
      log(`📡 API Request: POST ${url}`);
      log(`   Agent Ref: ${params.agentRef}`);
      log(`   Plan Ref: ${params.planRef}`);
      log(`   Customer Ref: ${params.customerRef}`);
      log(`   Idempotency Key: ${idempotencyKey}`);
      
      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...headers,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ 
          agentRef: params.agentRef,
          planRef: params.planRef,
          customerReference: params.customerRef
        }),
      });
      
      if (!res.ok) {
        const error = await res.text();
        log(`❌ API Error: ${res.status} - ${error}`);
        throw new SolvaPayError(`Create payment intent failed (${res.status}): ${error}`);
      }
      
      const result = await res.json();
      log(`✅ Payment intent created:`, {
        id: result.id,
        hasClientSecret: !!result.clientSecret,
        hasPublishableKey: !!result.publishableKey,
        accountId: result.accountId
      });
      return result;
    },
  };
}

