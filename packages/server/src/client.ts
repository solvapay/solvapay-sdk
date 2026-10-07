/**
 * SolvaPay Server SDK - API Client
 *
 * This module provides the API client implementation for communicating with
 * the SolvaPay backend. The client handles all HTTP requests for paywall
 * protection, usage tracking, and resource management.
 */

import { SolvaPayError } from '@solvapay/core'
import type { SolvaPayClient } from './types'

const API_ERROR_BODY_MAX = 240

function apiDebugLog(...args: unknown[]): void {
  if (process.env.SOLVAPAY_DEBUG === 'true') {
    // eslint-disable-next-line no-console
    console.log(...args)
  }
}

function isNonJsonResponseBody(body: string, contentType: string | null): boolean {
  const ct = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (ct.includes('json')) return false
  const trimmed = body.trimStart()
  if (trimmed.startsWith('<')) return true
  if (ct && !ct.includes('json')) return true
  return false
}

/**
 * The backend's error keys are snake_case (`payment_declined`,
 * `confirm_in_progress`); a plain NestJS body carries the HTTP reason
 * phrase in `error` (`Bad Request`), which is not a key.
 */
const ERROR_KEY = /^[a-z][a-z0-9_]*$/

/** What the client read out of a JSON error body. */
export interface ParsedApiErrorBody {
  /** The backend's error key, when the body is keyed. */
  code?: string
  /** The body's `message` (NestJS keeps the exception message there), joined when it is an array. */
  message?: string
  reason?: string
  declineCode?: string
}

/**
 * Read a JSON error body: the key, the message and, on a decline, the
 * reason and decline code. `undefined` when the body is not a JSON object.
 */
export function parseApiErrorBody(body: string): ParsedApiErrorBody | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const rawMessage = record.message
  const message =
    typeof rawMessage === 'string'
      ? rawMessage
      : Array.isArray(rawMessage) && rawMessage.every(m => typeof m === 'string')
        ? rawMessage.join('; ')
        : undefined
  // The vault routes key the body in `error`; other routes answer `code`.
  const keyed =
    typeof record.error === 'string' && ERROR_KEY.test(record.error) ? record.error : undefined
  const coded = typeof record.code === 'string' && record.code ? record.code : undefined
  const code = keyed ?? coded
  const detail = !keyed && coded && message ? `${coded}: ${message}` : (message ?? coded)
  return {
    ...(code ? { code } : {}),
    ...(detail ? { message: detail } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.declineCode === 'string' ? { declineCode: record.declineCode } : {}),
  }
}

async function throwApiError(operation: string, res: Response): Promise<never> {
  const body = await res.text()
  const contentType = res.headers.get('content-type')
  const nonJson = isNonJsonResponseBody(body, contentType)
  const snippet = body.length > API_ERROR_BODY_MAX ? `${body.slice(0, API_ERROR_BODY_MAX)}…` : body
  if (nonJson) {
    const detail = `non-JSON response (${contentType ?? 'unknown content-type'}): the API may not have been reached. Body: ${snippet}`
    apiDebugLog(`API error: ${res.status} ${detail}`)
    throw new SolvaPayError(`${operation} failed (${res.status}): ${detail}`, {
      status: res.status,
      code: 'non_json_response',
    })
  }
  const parsed = parseApiErrorBody(body)
  const detail = parsed?.message ?? snippet
  apiDebugLog(`API error: ${res.status} ${parsed?.code ?? ''} ${detail}`)
  throw new SolvaPayError(`${operation} failed (${res.status}): ${detail}`, {
    status: res.status,
    ...(parsed?.code ? { code: parsed.code } : {}),
    ...(parsed?.reason ? { reason: parsed.reason } : {}),
    ...(parsed?.declineCode ? { declineCode: parsed.declineCode } : {}),
  })
}

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
        await throwApiError('Check limits', res)
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
        await throwApiError('Track usage', res)
      }

      return await res.json()
    },

    // POST: /v1/sdk/usages/bulk
    async trackUsageBulk(params) {
      const url = `${base}/v1/sdk/usages/bulk`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Track usage bulk', res)
      }

      return await res.json()
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
        await throwApiError('Create customer', res)
      }

      const result = await res.json()
      return {
        customerRef: result.reference || result.customerRef,
      }
    },

    // PATCH: /v1/sdk/customers/{customerRef}
    async updateCustomer(customerRef, params) {
      const url = `${base}/v1/sdk/customers/${encodeURIComponent(customerRef)}`

      const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Update customer', res)
      }

      const result = await res.json()
      return {
        customerRef: result.reference || result.customerRef || customerRef,
      }
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
        await throwApiError('Get customer', res)
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

    // POST: /v1/sdk/customers/{reference}/credits
    async assignCredits(params) {
      const { customerRef, idempotencyKey, ...body } = params
      const url = `${base}/v1/sdk/customers/${encodeURIComponent(customerRef)}/credits`

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        await throwApiError('Assign credits', res)
      }

      return await res.json()
    },

    // GET: /v1/sdk/merchant
    async getMerchant() {
      const url = `${base}/v1/sdk/merchant`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        await throwApiError('Get merchant', res)
      }

      return res.json()
    },

    // GET: /v1/sdk/platform-config
    async getPlatformConfig() {
      const url = `${base}/v1/sdk/platform-config`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        await throwApiError('Get platform config', res)
      }

      return res.json()
    },

    // GET: /v1/sdk/products/{productRef}
    async getProduct(productRef) {
      const url = `${base}/v1/sdk/products/${encodeURIComponent(productRef)}`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        await throwApiError('Get product', res)
      }

      const result = await res.json()
      const data = (result.data as Record<string, unknown>) || {}
      return { ...data, ...result }
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
        await throwApiError('List products', res)
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
        await throwApiError('Create product', res)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/products/mcp/bootstrap
    async bootstrapMcpProduct(params) {
      const url = `${base}/v1/sdk/products/mcp/bootstrap`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Bootstrap MCP product', res)
      }

      return await res.json()
    },

    // PUT: /v1/sdk/products/{productRef}/mcp/plans
    async configureMcpPlans(productRef, params) {
      const url = `${base}/v1/sdk/products/${productRef}/mcp/plans`

      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Configure MCP plans', res)
      }

      return await res.json()
    },

    // DELETE: /v1/sdk/products/{productRef}
    async deleteProduct(productRef) {
      const url = `${base}/v1/sdk/products/${productRef}`

      const res = await fetch(url, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && res.status !== 404) {
        await throwApiError('Delete product', res)
      }
    },

    // POST: /v1/sdk/products/{productRef}/clone
    async cloneProduct(productRef, overrides) {
      const url = `${base}/v1/sdk/products/${productRef}/clone`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(overrides || {}),
      })

      if (!res.ok) {
        await throwApiError('Clone product', res)
      }

      return await res.json()
    },

    // GET: /v1/sdk/products/{productRef}/plans
    async listPlans(productRef) {
      const url = `${base}/v1/sdk/products/${productRef}/plans`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        await throwApiError('List plans', res)
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
        await throwApiError('Create plan', res)
      }

      const result = await res.json()
      return result
    },

    // PUT: /v1/sdk/products/{productRef}/plans/{planRef}
    async updatePlan(productRef, planRef, params) {
      const url = `${base}/v1/sdk/products/${productRef}/plans/${planRef}`

      const res = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Update plan', res)
      }

      return await res.json()
    },

    // DELETE: /v1/sdk/products/{productRef}/plans/{planRef}
    async deletePlan(productRef, planRef) {
      const url = `${base}/v1/sdk/products/${productRef}/plans/${planRef}`

      const res = await fetch(url, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && res.status !== 404) {
        await throwApiError('Delete plan', res)
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
          customerRef: params.customerRef,
          ...(params.currency && { currency: params.currency }),
        }),
      })

      if (!res.ok) {
        await throwApiError('Create payment intent', res)
      }

      return await res.json()
    },

    // POST: /v1/sdk/payment-intents (purpose: credit_topup)
    async createTopupPaymentIntent(params) {
      const idempotencyKey =
        params.idempotencyKey || `topup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      const url = `${base}/v1/sdk/payment-intents`

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          customerRef: params.customerRef,
          purpose: 'credit_topup',
          amount: params.amount,
          currency: params.currency,
          description: params.description,
          ...(params.autoRecharge ? { autoRecharge: params.autoRecharge } : {}),
        }),
      })

      if (!res.ok) {
        await throwApiError('Create topup payment intent', res)
      }

      return await res.json()
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
        await throwApiError('Process payment', res)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/payment-intents/{paymentIntentId}/capture-grant
    async createCaptureGrant(params) {
      const url = `${base}/v1/sdk/payment-intents/${encodeURIComponent(params.paymentIntentId)}/capture-grant`
      const res = await fetch(url, { method: 'POST', headers })
      if (!res.ok) {
        await throwApiError('Create capture grant', res)
      }
      return await res.json()
    },

    // POST: /v1/sdk/payment-intents/{paymentIntentId}/confirm
    async confirmPayment(params) {
      const url = `${base}/v1/sdk/payment-intents/${encodeURIComponent(params.paymentIntentId)}/confirm`
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...(params.cardId !== undefined && { cardId: params.cardId }),
          ...(params.paymentMethodId !== undefined && { paymentMethodId: params.paymentMethodId }),
          ...(params.returnUrl !== undefined && { returnUrl: params.returnUrl }),
          ...(params.billingDetails !== undefined && { billingDetails: params.billingDetails }),
        }),
      })
      if (!res.ok) {
        await throwApiError('Confirm payment', res)
      }
      return await res.json()
    },

    // GET: /v1/sdk/customers/customer-sessions/{sessionId}
    async getCustomerSession(params) {
      const url = `${base}/v1/sdk/customers/customer-sessions/${encodeURIComponent(params.sessionId)}`
      const res = await fetch(url, { method: 'GET', headers })
      if (!res.ok) {
        await throwApiError('Get customer session', res)
      }
      return await res.json()
    },

    // POST: /v1/customer-sessions/{sessionId}/capture-grant
    async createCustomerSessionCaptureGrant(params) {
      const url = `${base}/v1/customer-sessions/${encodeURIComponent(params.sessionId)}/capture-grant`
      const res = await fetch(url, { method: 'POST', headers })
      if (!res.ok) {
        await throwApiError('Create card setup grant', res)
      }
      return await res.json()
    },

    // POST: /v1/customer-sessions/{sessionId}/payment-methods
    async saveCustomerSessionCard(params) {
      const url = `${base}/v1/customer-sessions/${encodeURIComponent(params.sessionId)}/payment-methods`
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          'completePendingSetup' in params
            ? { completePendingSetup: true }
            : {
                cardId: params.cardId,
                returnUrl: params.returnUrl,
                ...(params.billingDetails !== undefined && {
                  billingDetails: params.billingDetails,
                }),
              },
        ),
      })
      if (!res.ok) {
        await throwApiError('Save card', res)
      }
      return await res.json()
    },

    // POST: /v1/sdk/payment-intents/{paymentIntentId}/business-details
    async attachBusinessDetails(params) {
      const url = `${base}/v1/sdk/payment-intents/${params.paymentIntentId}/business-details`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          isBusiness: params.isBusiness,
          ...(params.businessName !== undefined && { businessName: params.businessName }),
          ...(params.country !== undefined && { country: params.country }),
          ...(params.taxId !== undefined && { taxId: params.taxId }),
          ...(params.taxIdType !== undefined && { taxIdType: params.taxIdType }),
          ...(params.customerRef !== undefined && { customerRef: params.customerRef }),
        }),
      })

      if (!res.ok) {
        await throwApiError('Cancel purchase', res)
      }

      // Get response text first to debug any parsing issues
      const responseText = await res.text()

      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (parseError) {
        apiDebugLog(`❌ Failed to parse response as JSON: ${parseError}`)
        throw new SolvaPayError(
          `Invalid JSON response from cancel purchase endpoint: ${responseText.substring(0, 200)}`,
        )
      }

      // Validate response structure
      if (!responseData || typeof responseData !== 'object') {
        apiDebugLog(`❌ Invalid response structure: ${JSON.stringify(responseData)}`)
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
        apiDebugLog(`❌ Invalid purchase data in response. Full response:`, responseData)
        throw new SolvaPayError(`Invalid purchase data in cancel purchase response`)
      }

      return result
    },

    // POST: /v1/sdk/purchases/{purchaseRef}/reactivate
    async reactivatePurchase(params) {
      const url = `${base}/v1/sdk/purchases/${params.purchaseRef}/reactivate`

      const res = await fetch(url, {
        method: 'POST',
        headers,
      })

      if (!res.ok) {
        await throwApiError('Reactivate purchase', res)
      }

      const responseText = await res.text()

      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (parseError) {
        apiDebugLog(`❌ Failed to parse response as JSON: ${parseError}`)
        throw new SolvaPayError(
          `Invalid JSON response from reactivate purchase endpoint: ${responseText.substring(0, 200)}`,
        )
      }

      if (!responseData || typeof responseData !== 'object') {
        apiDebugLog(`❌ Invalid response structure: ${JSON.stringify(responseData)}`)
        throw new SolvaPayError(`Invalid response structure from reactivate purchase endpoint`)
      }

      let result
      if (responseData.purchase && typeof responseData.purchase === 'object') {
        result = responseData.purchase
      } else if (responseData.reference) {
        result = responseData
      } else {
        result = responseData.purchase || responseData
      }

      if (!result || typeof result !== 'object') {
        apiDebugLog(`❌ Invalid purchase data in response. Full response:`, responseData)
        throw new SolvaPayError(`Invalid purchase data in reactivate purchase response`)
      }

      return result
    },

    // POST: /v1/sdk/user-info
    async getUserInfo(params) {
      const url = `${base}/v1/sdk/user-info`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Get user info', res)
      }

      return await res.json()
    },

    // GET: /v1/sdk/customers/:customerRef/balance
    async getCustomerBalance(params) {
      const url = `${base}/v1/sdk/customers/${params.customerRef}/balance`

      const res = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (!res.ok) {
        await throwApiError('Get customer balance', res)
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
        await throwApiError('Create checkout session', res)
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
        await throwApiError('Create customer session', res)
      }

      const result = await res.json()
      return result
    },

    // POST: /v1/sdk/activate
    async activatePlan(params) {
      const url = `${base}/v1/sdk/activate`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Activate plan', res)
      }

      return await res.json()
    },

    async getPaymentMethod(params) {
      const url = new URL(`${base}/v1/sdk/payment-method`)
      url.searchParams.set('customerRef', params.customerRef)

      const res = await fetch(url.toString(), { method: 'GET', headers })

      if (!res.ok) {
        await throwApiError('Get payment method', res)
      }

      return await res.json()
    },

    async removePaymentMethod(params) {
      const url = new URL(`${base}/v1/sdk/payment-method`)
      url.searchParams.set('customerRef', params.customerRef)

      const res = await fetch(url.toString(), { method: 'DELETE', headers })

      if (!res.ok) {
        await throwApiError('Remove payment method', res)
      }

      return await res.json()
    },

    async getAutoRecharge(params) {
      const url = new URL(`${base}/v1/sdk/auto-recharge`)
      url.searchParams.set('customerRef', params.customerRef)

      const res = await fetch(url.toString(), { method: 'GET', headers })

      if (!res.ok) {
        await throwApiError('Get auto-recharge', res)
      }

      return await res.json()
    },

    async saveAutoRecharge(params) {
      const res = await fetch(`${base}/v1/sdk/auto-recharge`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        await throwApiError('Save auto-recharge', res)
      }

      return await res.json()
    },

    async disableAutoRecharge(params) {
      const url = new URL(`${base}/v1/sdk/auto-recharge`)
      url.searchParams.set('customerRef', params.customerRef)

      const res = await fetch(url.toString(), { method: 'DELETE', headers })

      if (!res.ok) {
        await throwApiError('Disable auto-recharge', res)
      }

      return await res.json()
    },

    async listPurchases(params) {
      const url = new URL(`${base}/v1/sdk/purchases`)
      if (params.customerRef) url.searchParams.set('customerRef', params.customerRef)
      if (params.productRef) url.searchParams.set('productRef', params.productRef)
      if (params.status) url.searchParams.set('status', params.status)
      if (params.includeFree !== undefined) {
        url.searchParams.set('includeFree', String(params.includeFree))
      }

      const res = await fetch(url.toString(), { method: 'GET', headers })

      if (!res.ok) {
        await throwApiError('List purchases', res)
      }

      const data = (await res.json()) as { purchases?: import('./types/client').PurchaseInfo[] }
      return { purchases: data.purchases ?? [] }
    },

    async getCreditActivity(params) {
      const url = new URL(`${base}/v1/sdk/credits/activity`)
      url.searchParams.set('customerRef', params.customerRef)
      if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit))

      const res = await fetch(url.toString(), { method: 'GET', headers })

      if (!res.ok) {
        await throwApiError('Get credit activity', res)
      }

      return await res.json()
    },
  }
}
