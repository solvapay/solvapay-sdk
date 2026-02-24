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
 * const products = await client.listProducts();
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
  const log = (...args: unknown[]) => {
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

    // GET: /v1/sdk/customers/{reference} or /v1/sdk/customers?externalRef={externalRef}|email={email}
    async getCustomer(params) {
      let url
      let isByExternalRef = false
      let isByEmail = false

      if (params.externalRef) {
        url = `${base}/v1/sdk/customers?externalRef=${encodeURIComponent(params.externalRef)}`
        isByExternalRef = true
      } else if (params.email) {
        url = `${base}/v1/sdk/customers?email=${encodeURIComponent(params.email)}`
        isByEmail = true
      } else if (params.customerRef) {
        url = `${base}/v1/sdk/customers/${params.customerRef}`
      } else {
        throw new SolvaPayError('One of customerRef, externalRef, or email must be provided')
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

      // If getting by externalRef, support all backend response shapes:
      // - direct customer object
      // - array of customers
      // - wrapped object with `customers` or `customer`
      let customer = result
      if (isByExternalRef || isByEmail) {
        const directCustomer =
          result &&
          typeof result === 'object' &&
          (result.reference || result.customerRef || result.externalRef)
            ? result
            : undefined

        const wrappedCustomer =
          result && typeof result === 'object' && result.customer ? result.customer : undefined

        const customers = Array.isArray(result)
          ? result
          : result && typeof result === 'object' && Array.isArray(result.customers)
            ? result.customers
            : []

        customer = directCustomer || wrappedCustomer || customers[0]

        if (!customer) {
          throw new SolvaPayError(`No customer found with externalRef: ${params.externalRef}`)
        }
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

    // Product management methods (primarily for integration tests)

    // GET: /v1/sdk/products
    async listProducts() {
      const url = `${base}/v1/sdk/products`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`List products failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      // Handle both direct array and wrapped object formats
      const products = Array.isArray(result) ? result : result.products || []

      // Unwrap data field if present
      return products.map((product: Record<string, unknown>) => ({
        ...product,
        ...((product.data as Record<string, unknown>) || {}),
      }))
    },

    // POST: /v1/sdk/products
    async createProduct(params) {
      const url = `${base}/v1/sdk/products`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Create product failed (${res.status}): ${error}`)
      }

      const result = await res.json()
      return result
    },

    // DELETE: /v1/sdk/products/{productRef}
    async deleteProduct(productRef) {
      const url = `${base}/v1/sdk/products/${productRef}`

      const res = await fetch(url, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && res.status !== 404) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Delete product failed (${res.status}): ${error}`)
      }
    },

    // GET: /v1/sdk/products/{productRef}/plans
    async listPlans(productRef) {
      const url = `${base}/v1/sdk/products/${productRef}/plans`

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
      return plans.map((plan: Record<string, unknown>) => {
        const data = (plan.data as Record<string, unknown>) || {}
        const price = plan.price ?? data.price

        const unwrapped: Record<string, unknown> = {
          ...data,
          ...plan,
          ...(price !== undefined && { price }),
        }
        delete unwrapped.data

        return unwrapped
      })
    },

    // POST: /v1/sdk/products/{productRef}/plans
    async createPlan(params) {
      const url = `${base}/v1/sdk/products/${params.productRef}/plans`

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

    // DELETE: /v1/sdk/products/{productRef}/plans/{planRef}
    async deletePlan(productRef, planRef) {
      const url = `${base}/v1/sdk/products/${productRef}/plans/${planRef}`

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
          productRef: params.productRef,
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
    async processPaymentIntent(params) {
      const url = `${base}/v1/sdk/payment-intents/${params.paymentIntentId}/process`

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productRef: params.productRef,
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

    // POST: /v1/sdk/purchases/{purchaseRef}/cancel
    async cancelPurchase(params) {
      const url = `${base}/v1/sdk/purchases/${params.purchaseRef}/cancel`

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
            `Purchase cannot be cancelled or does not belong to provider: ${error}`,
          )
        }

        throw new SolvaPayError(`Cancel purchase failed (${res.status}): ${error}`)
      }

      // Get response text first to debug any parsing issues
      const responseText = await res.text()

      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (parseError) {
        log(`❌ Failed to parse response as JSON: ${parseError}`)
        throw new SolvaPayError(
          `Invalid JSON response from cancel purchase endpoint: ${responseText.substring(0, 200)}`,
        )
      }

      // Validate response structure
      if (!responseData || typeof responseData !== 'object') {
        log(`❌ Invalid response structure: ${JSON.stringify(responseData)}`)
        throw new SolvaPayError(`Invalid response structure from cancel purchase endpoint`)
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
        throw new SolvaPayError(`Invalid purchase data in cancel purchase response`)
      }

      return result
    },

    // POST: /v1/sdk/vouchers/resolve
    async resolveVoucher(params) {
      const url = `${base}/v1/sdk/vouchers/resolve`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Resolve voucher failed (${res.status}): ${error}`)
      }

      return await res.json()
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

    // POST: /v1/sdk/vouchers/verify
    async verifyVoucherPayment(params) {
      const url = `${base}/v1/sdk/vouchers/verify`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Verify voucher payment failed (${res.status}): ${error}`)
      }

      return await res.json()
    },

    // POST: /v1/sdk/vouchers/settle
    async settleVoucherPayment(params) {
      const url = `${base}/v1/sdk/vouchers/settle`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Settle voucher payment failed (${res.status}): ${error}`)
      }

      return await res.json()
    },

    // POST: /v1/sdk/vouchers/release
    async releaseVoucherPayment(params) {
      const url = `${base}/v1/sdk/vouchers/release`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Release voucher payment failed (${res.status}): ${error}`)
      }

      return await res.json()
    },

    // POST: /v1/sdk/tokens/verify
    async verifyPayment(params) {
      const url = `${base}/v1/sdk/tokens/verify`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Verify payment failed (${res.status}): ${error}`)
      }

      return await res.json()
    },

    // POST: /v1/sdk/tokens/settle
    async settlePayment(params) {
      const url = `${base}/v1/sdk/tokens/settle`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Settle payment failed (${res.status}): ${error}`)
      }

      return await res.json()
    },

    // POST: /v1/sdk/tokens/release
    async releasePayment(params) {
      const url = `${base}/v1/sdk/tokens/release`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Release payment failed (${res.status}): ${error}`)
      }

      return await res.json()
    },

    // GET: /v1/sdk/tokens/wallet?accountRef=...
    async getTokenWallet(accountRef) {
      const url = `${base}/v1/sdk/tokens/wallet?accountRef=${encodeURIComponent(accountRef)}`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        const error = await res.text()
        log(`❌ API Error: ${res.status} - ${error}`)
        throw new SolvaPayError(`Get token wallet failed (${res.status}): ${error}`)
      }

      return await res.json()
    },
  }
}
