/**
 * SolvaPay Server SDK - API Client
 *
 * This module provides the API client implementation for communicating with
 * the SolvaPay backend. The client handles all HTTP requests for paywall
 * protection, usage tracking, and resource management.
 */

import { SolvaPayError } from '@solvapay/core'
import type { SolvaPayClient } from './types'

/**
 * Configuration options for creating a SolvaPay API client
 */
export type ServerClientOptions = {
  /**
   * Your SolvaPay API key (required)
   */
  apiKey: string

  /**
   * Base URL for the SolvaPay API (optional)
   * Defaults to https://api.solvapay.com
   */
  apiBaseUrl?: string
}

/**
 * Creates a SolvaPay API client that implements the full SolvaPayClient interface.
 *
 * This function creates a low-level API client for direct communication with the
 * SolvaPay backend. For most use cases, use `createSolvaPay()` instead, which
 * provides a higher-level API with paywall protection.
 *
 * Use this function when you need:
 * - Direct API access for custom operations
 * - Testing with custom client implementations
 * - Advanced use cases not covered by the main API
 *
 * @param opts - Configuration options
 * @param opts.apiKey - Your SolvaPay API key (required)
 * @param opts.apiBaseUrl - Optional API base URL override
 * @returns A fully configured SolvaPayClient instance
 * @throws {SolvaPayError} If API key is missing
 *
 * @example
 * ```typescript
 * // Create API client directly
 * const client = createSolvaPayClient({
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY!,
 *   apiBaseUrl: 'https://api.solvapay.com' // optional
 * });
 *
 * // Use client for custom operations
 * const agents = await client.listAgents();
 * ```
 *
 * @see {@link createSolvaPay} for the recommended high-level API
 * @see {@link ServerClientOptions} for configuration options
 * @since 1.0.0
 */
export function createSolvaPayClient(opts: ServerClientOptions): SolvaPayClient {
  const base = opts.apiBaseUrl ?? 'https://api.solvapay.com'
  if (!opts.apiKey) throw new SolvaPayError('Missing apiKey')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  }

  // Enable debug logging via environment variable (same pattern as paywall)
  const debug = process.env.SOLVAPAY_DEBUG === 'true'
  const log = (...args: any[]) => {
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(...args)
    }
  }

  return {
    // POST: /v1/sdk/limits
    async checkLimits(params) {
      const url = `${base}/v1/sdk/limits`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Check limits failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/usages
    async trackUsage(params) {
      const url = `${base}/v1/sdk/usages`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Track usage failed (${res.status}): ${error}`)
      }
    },

    // POST: /v1/sdk/customers
    async createCustomer(params) {
      const url = `${base}/v1/sdk/customers`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create customer failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // GET: /v1/sdk/customers/{reference} or /v1/sdk/customers?externalRef={externalRef}
    async getCustomer(params) {
      let url
      let isByExternalRef = false

      if (params.externalRef) {
        url = `${base}/v1/sdk/customers?externalRef=${encodeURIComponent(params.externalRef)}`
        isByExternalRef = true
      } else if (params.customerRef) {
        url = `${base}/v1/sdk/customers/${params.customerRef}`
      } else {
        throw new SolvaPayError('Either customerRef or externalRef must be provided')
      }

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Get customer failed (${res.status}): ${error}`)
      }

      const result = await res.json()

      // If getting by externalRef, the result might be an array or wrapped object
      let customer = result
      if (isByExternalRef) {
        const customers = Array.isArray(result) ? result : result.customers || []
        if (customers.length === 0) {
          throw new SolvaPayError(`No customer found with externalRef: ${params.externalRef}`)
        }
        customer = customers[0]
      }

      // Map response fields to expected format
      // Note: purchases may include additional fields like endDate, cancelledAt
      // even though they're not in the PurchaseInfo type definition
      return {
        customerRef: customer.reference || customer.customerRef,
        email: customer.email,
        name: customer.name,
        externalRef: customer.externalRef,
        purchases: customer.purchases || [],
      }
    },

    // Management methods (primarily for integration tests)

    // GET: /v1/sdk/agents
    async listAgents() {
      const url = `${base}/v1/sdk/agents`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`List agents failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      // Handle both direct array and wrapped object formats
      const agents = Array.isArray(result) ? result : result.agents || []

      // Unwrap data field if present
      return agents.map((agent: any) => ({
        ...agent,
        ...(agent.data || {}),
      }))
    },

    // POST: /v1/sdk/agents
    async createAgent(params) {
      const url = `${base}/v1/sdk/agents`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create agent failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // DELETE: /v1/sdk/agents/{agentRef}
    async deleteAgent(agentRef) {
      const url = `${base}/v1/sdk/agents/${agentRef}`

      const res = await fetch(url, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && res.status !== 404) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Delete agent failed (${res.status}): ${error}`)
      }
    },

    // GET: /v1/sdk/agents/{agentRef}/plans
    async listPlans(agentRef) {
      const url = `${base}/v1/sdk/agents/${agentRef}/plans`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`List plans failed (${res.status}): ${error}`)
      }

      const result = await res.json()

      // Handle both direct array and wrapped object formats
      const plans = Array.isArray(result) ? result : result.plans || []

      // Unwrap data field if present, preserving all plan properties
      // Spread plan.data first, then plan, so plan properties take precedence
      return plans.map((plan: any) => {
        // Preserve price from either plan or plan.data
        const price = plan.price ?? plan.data?.price

        const unwrapped = {
          ...(plan.data || {}),
          ...plan,
          // Explicitly preserve price field to ensure it's not lost
          ...(price !== undefined && { price }),
        }
        // Remove the data field if it was present, as we've already unwrapped it
        delete unwrapped.data

        return unwrapped
      })
    },

    // POST: /v1/sdk/agents/{agentRef}/plans
    async createPlan(params) {
      const url = `${base}/v1/sdk/agents/${params.agentRef}/plans`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create plan failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // DELETE: /v1/sdk/agents/{agentRef}/plans/{planRef}
    async deletePlan(agentRef, planRef) {
      const url = `${base}/v1/sdk/agents/${agentRef}/plans/${planRef}`

      const res = await fetch(url, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && res.status !== 404) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Delete plan failed (${res.status}): ${error}`)
      }
    },

    // POST: /payment-intents
    async createPaymentIntent(params) {
      const idempotencyKey =
        params.idempotencyKey ||
        `payment-${params.planRef}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      const url = `${base}/v1/sdk/payment-intents`

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          agentRef: params.agentRef,
          planRef: params.planRef,
          customerReference: params.customerRef,
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create payment intent failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/payment-intents/{paymentIntentId}/process
    async processPayment(params) {
      const url = `${base}/v1/sdk/payment-intents/${params.paymentIntentId}/process`

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentRef: params.agentRef,
          customerRef: params.customerRef,
          planRef: params.planRef,
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Process payment failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/purchases/{purchaseRef}/cancel-renewal
    async cancelRenewal(params) {
      const url = `${base}/v1/sdk/purchases/${params.purchaseRef}/cancel-renewal`

      // Prepare request options
      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
      }

      // Only include body if reason is provided (backend body is optional)
      if (params.reason) {
        requestOptions.body = JSON.stringify({ reason: params.reason })
      }

      const res = await fetch(url, requestOptions)

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)

        if (res.status === 404) {
          throw new SolvaPayError(`Purchase not found: ${error}`)
        }

        if (res.status === 400) {
          throw new SolvaPayError(
            `Renewal cannot be cancelled or purchase does not belong to provider: ${error}`,
          )
        }

        throw new SolvaPayError(`Cancel renewal failed (${res.status}): ${error}`)
      }

      // Get response text first to debug any parsing issues
      const responseText = await res.text()

      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (parseError) {
        log(`❌ Failed to parse response as JSON: ${parseError}`)
        throw new SolvaPayError(
          `Invalid JSON response from cancel renewal endpoint: ${responseText.substring(0, 200)}`,
        )
      }

      // Validate response structure
      if (!responseData || typeof responseData !== 'object') {
        log(`❌ Invalid response structure: ${JSON.stringify(responseData)}`)
        throw new SolvaPayError(`Invalid response structure from cancel renewal endpoint`)
      }

      // Backend returns nested structure: { purchase: {...}, message: "..." }
      // Extract the purchase object from the response
      let result
      if (responseData.purchase && typeof responseData.purchase === 'object') {
        result = responseData.purchase
      } else if (responseData.reference) {
        result = responseData
      } else {
        // Try to extract anyway or use the whole response
        result = responseData.purchase || responseData
      }

      // Check if response has expected fields
      if (!result || typeof result !== 'object') {
        log(`❌ Invalid purchase data in response. Full response:`, responseData)
        throw new SolvaPayError(`Invalid purchase data in cancel renewal response`)
      }

      return result
    },

    // POST: /v1/sdk/checkout-sessions
    async createCheckoutSession(params) {
      const url = `${base}/v1/sdk/checkout-sessions`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create checkout session failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/customers/customer-sessions
    async createCustomerSession(params) {
      const url = `${base}/v1/sdk/customers/customer-sessions`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create customer session failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },
  }
}
