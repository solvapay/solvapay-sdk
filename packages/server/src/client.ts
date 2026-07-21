/**
 * SolvaPay Server SDK - API Client
 *
 * This module provides the API client implementation for communicating with
 * the SolvaPay backend. The client handles all HTTP requests for paywall
 * protection, usage tracking, and resource management.
 */

import { SolvaPayError } from '@solvapay/core'
import type { SolvaPayClient } from './types'

/** Groups A–C methods delegated to napi `NativeClient` under `SOLVAPAY_IMPL=rust`. */
type NativeClientMethod =
  | 'createCustomer'
  | 'updateCustomer'
  | 'getCustomer'
  | 'assignCredits'
  | 'getCustomerBalance'
  | 'getUserInfo'
  | 'createCheckoutSession'
  | 'createCustomerSession'
  | 'getMerchant'
  | 'getPlatformConfig'
  | 'createPaymentIntent'
  | 'createTopupPaymentIntent'
  | 'processPaymentIntent'
  | 'attachBusinessDetails'
  | 'activatePlan'
  | 'checkLimits'
  | 'trackUsage'
  | 'trackUsageBulk'
  | 'getProduct'
  | 'listProducts'
  | 'createProduct'
  | 'updateProduct'
  | 'deleteProduct'
  | 'cloneProduct'
  | 'bootstrapMcpProduct'
  | 'configureMcpPlans'
  | 'listPlans'
  | 'createPlan'
  | 'updatePlan'
  | 'deletePlan'
  | 'cancelPurchase'
  | 'reactivatePurchase'
  | 'getPaymentMethod'
  | 'getAutoRecharge'
  | 'saveAutoRecharge'
  | 'disableAutoRecharge'

/**
 * True on Deno / Cloudflare Workers / Vercel Edge-light — even when those
 * hosts expose a `process` / `nodejs_compat` shim that looks Node-like.
 */
function isEdgeRuntime(): boolean {
  try {
    if ((globalThis as { Deno?: unknown }).Deno !== undefined) return true
  } catch {
    // ignore
  }
  try {
    const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator
    if (nav?.userAgent === 'Cloudflare-Workers') return true
  } catch {
    // ignore
  }
  try {
    if ((globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== undefined) {
      return true
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * True on the Node.js runtime (not Deno / Workers / edge-light). Deno and
 * Workers are treated as edge even when they expose a `process` shim.
 */
function isNodeRuntime(): boolean {
  try {
    if (isEdgeRuntime()) return false
    return (
      typeof process !== 'undefined' &&
      typeof process.versions === 'object' &&
      process.versions != null &&
      typeof process.versions.node === 'string'
    )
  } catch {
    return false
  }
}

/**
 * Whether this runtime may attempt the Node napi client path.
 * Edge / browser must never load `./native` (`node:module`).
 */
function shouldAttemptNativeClient(): boolean {
  try {
    return isNodeRuntime() && process.env.SOLVAPAY_IMPL !== 'ts'
  } catch {
    return false
  }
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

  // Enable debug logging via environment variable (same pattern as paywall)
  const debug = process.env.SOLVAPAY_DEBUG === 'true'
  const log = (...args: unknown[]) => {
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(...args)
    }
  }

  const nativeConfig = { apiKey: opts.apiKey, apiBaseUrl: opts.apiBaseUrl }

  /**
   * Dispatches a Groups A–C client method to a Rust binding when the resolved
   * implementation is `rust`. Returns the envelope `value` verbatim — do not
   * re-apply TS response normalization.
   *
   * Runtime split (both via dynamic import so neither graph statically pulls
   * the other):
   * - Edge (Deno / Workers / edge-light) → `@solvapay/server-wasm` via `./wasm`.
   *   The edge bundle never imports `./native` / `node:module`.
   * - Node → `@solvapay/server-native` via `./native`.
   * - Node vitest with an injected `WasmClient` override → the WASM path (so
   *   `client-wasm-dispatch` can exercise edge dispatch under Node).
   */
  async function dispatchClient<T>(
    fn: NativeClientMethod,
    params: unknown,
    tsFallback: () => Promise<T>,
  ): Promise<T> {
    const argsJson = JSON.stringify(params ?? {})

    // Edge (Deno / Workers / edge-light) — never touch `./native`.
    // Also used under Node vitest when a fake WasmClient override is installed.
    if (!isNodeRuntime()) {
      const wasm = await import('./wasm')
      if (wasm.resolveEdgeImpl('client') !== 'rust') {
        return tsFallback()
      }
      return (await wasm.callWasm(fn, argsJson, nativeConfig)) as T
    }

    // Node vitest: injected WasmClient forces the edge dispatch path without
    // requiring a Deno/Workers runtime.
    const wasm = await import('./wasm')
    if (wasm.isWasmClientOverrideActive()) {
      if (wasm.resolveEdgeImpl('client') !== 'rust') {
        return tsFallback()
      }
      return (await wasm.callWasm(fn, argsJson, nativeConfig)) as T
    }

    if (!shouldAttemptNativeClient()) {
      return tsFallback()
    }
    // Non-literal specifier so edge rebundlers (wrangler/esbuild) that pull in
    // this shared module cannot statically resolve the Node-only `./native`
    // graph into a Workers bundle (tsup already externalizes it for edge.js).
    const nativeSpecifier: string = ['./', 'native'].join('')
    const { callNative, resolveImpl } = (await import(nativeSpecifier)) as {
      callNative: (
        method: NativeClientMethod,
        json: string,
        config: { apiKey: string; apiBaseUrl?: string },
      ) => Promise<unknown>
      resolveImpl: (surface: string) => 'ts' | 'rust'
    }
    if (resolveImpl('client') !== 'rust') {
      return tsFallback()
    }
    return (await callNative(fn, argsJson, nativeConfig)) as T
  }

  return {
    // POST: /v1/sdk/limits
    async checkLimits(params) {
      return dispatchClient('checkLimits', params, async () => {
        const url = `${base}/v1/sdk/limits`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Check limits failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return result
      })
    },

    // POST: /v1/sdk/usages
    async trackUsage(params) {
      return dispatchClient('trackUsage', params, async () => {
        const url = `${base}/v1/sdk/usages`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Track usage failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // POST: /v1/sdk/usages/bulk
    async trackUsageBulk(params) {
      return dispatchClient('trackUsageBulk', params, async () => {
        const url = `${base}/v1/sdk/usages/bulk`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Track usage bulk failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // POST: /v1/sdk/customers
    async createCustomer(params) {
      return dispatchClient('createCustomer', params, async () => {
        const url = `${base}/v1/sdk/customers`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create customer failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return {
          customerRef: result.reference || result.customerRef,
        }
      })
    },

    // PATCH: /v1/sdk/customers/{customerRef}
    async updateCustomer(customerRef, params) {
      // Rust splits path vs body from a single args object (fixture parity).
      return dispatchClient(
        'updateCustomer',
        { customerRef, ...params },
        async () => {
          const url = `${base}/v1/sdk/customers/${encodeURIComponent(customerRef)}`

          const res = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(params),
          })

          if (!res.ok) {
            const error = await res.text()
            log(`❌ API Error: ${res.status} - ${error}`)
            throw new SolvaPayError(`Update customer failed (${res.status}): ${error}`, {
              status: res.status,
            })
          }

          const result = await res.json()
          return {
            customerRef: result.reference || result.customerRef || customerRef,
          }
        },
      )
    },

    // GET: /v1/sdk/customers/{reference} or /v1/sdk/customers?externalRef={externalRef}|email={email}
    async getCustomer(params) {
      return dispatchClient('getCustomer', params, async () => {
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
          throw new SolvaPayError(`Get customer failed (${res.status}): ${error}`, {
            status: res.status,
          })
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
      })
    },

    // POST: /v1/sdk/customers/{reference}/credits
    async assignCredits(params) {
      return dispatchClient('assignCredits', params, async () => {
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
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Assign credits failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // GET: /v1/sdk/merchant
    async getMerchant() {
      return dispatchClient('getMerchant', {}, async () => {
        const url = `${base}/v1/sdk/merchant`

        const res = await fetch(url, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get merchant failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return res.json()
      })
    },

    // GET: /v1/sdk/platform-config
    async getPlatformConfig() {
      return dispatchClient('getPlatformConfig', {}, async () => {
        const url = `${base}/v1/sdk/platform-config`

        const res = await fetch(url, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get platform config failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return res.json()
      })
    },

    // GET: /v1/sdk/products/{productRef}
    async getProduct(productRef) {
      return dispatchClient('getProduct', { productRef }, async () => {
        const url = `${base}/v1/sdk/products/${encodeURIComponent(productRef)}`

        const res = await fetch(url, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get product failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        const data = (result.data as Record<string, unknown>) || {}
        return { ...data, ...result }
      })
    },

    // Product management methods (primarily for integration tests)

    // GET: /v1/sdk/products
    async listProducts() {
      return dispatchClient('listProducts', {}, async () => {
        const url = `${base}/v1/sdk/products`

        const res = await fetch(url, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`List products failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        // Handle both direct array and wrapped object formats
        const products = Array.isArray(result) ? result : result.products || []

        // Unwrap data field if present
        return products.map((product: Record<string, unknown>) => ({
          ...product,
          ...((product.data as Record<string, unknown>) || {}),
        }))
      })
    },

    // POST: /v1/sdk/products
    async createProduct(params) {
      return dispatchClient('createProduct', params, async () => {
        const url = `${base}/v1/sdk/products`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create product failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return result
      })
    },

    // POST: /v1/sdk/products/mcp/bootstrap
    async bootstrapMcpProduct(params) {
      return dispatchClient('bootstrapMcpProduct', params, async () => {
        const url = `${base}/v1/sdk/products/mcp/bootstrap`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Bootstrap MCP product failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // PUT: /v1/sdk/products/{productRef}/mcp/plans
    async configureMcpPlans(productRef, params) {
      return dispatchClient('configureMcpPlans', { productRef, ...params }, async () => {
        const url = `${base}/v1/sdk/products/${productRef}/mcp/plans`

        const res = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Configure MCP plans failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // PUT: /v1/sdk/products/{productRef}
    async updateProduct(productRef, params) {
      return dispatchClient('updateProduct', { productRef, ...params }, async () => {
        const url = `${base}/v1/sdk/products/${productRef}`

        const res = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Update product failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // DELETE: /v1/sdk/products/{productRef}
    async deleteProduct(productRef) {
      return dispatchClient('deleteProduct', { productRef }, async () => {
        const url = `${base}/v1/sdk/products/${productRef}`

        const res = await fetch(url, {
          method: 'DELETE',
          headers,
        })

        if (!res.ok && res.status !== 404) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Delete product failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }
      })
    },

    // POST: /v1/sdk/products/{productRef}/clone
    async cloneProduct(productRef, overrides) {
      return dispatchClient(
        'cloneProduct',
        { productRef, ...(overrides ?? {}) },
        async () => {
          const url = `${base}/v1/sdk/products/${productRef}/clone`

          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(overrides || {}),
          })

          if (!res.ok) {
            const error = await res.text()
            log(`❌ API Error: ${res.status} - ${error}`)
            throw new SolvaPayError(`Clone product failed (${res.status}): ${error}`, {
              status: res.status,
            })
          }

          return await res.json()
        },
      )
    },

    // GET: /v1/sdk/products/{productRef}/plans
    async listPlans(productRef) {
      return dispatchClient('listPlans', { productRef }, async () => {
        const url = `${base}/v1/sdk/products/${productRef}/plans`

        const res = await fetch(url, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`List plans failed (${res.status}): ${error}`, {
            status: res.status,
          })
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
      })
    },

    // POST: /v1/sdk/products/{productRef}/plans
    async createPlan(params) {
      return dispatchClient('createPlan', params, async () => {
        const url = `${base}/v1/sdk/products/${params.productRef}/plans`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create plan failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return result
      })
    },

    // PUT: /v1/sdk/products/{productRef}/plans/{planRef}
    async updatePlan(productRef, planRef, params) {
      return dispatchClient(
        'updatePlan',
        { productRef, planRef, ...params },
        async () => {
          const url = `${base}/v1/sdk/products/${productRef}/plans/${planRef}`

          const res = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify(params),
          })

          if (!res.ok) {
            const error = await res.text()
            log(`❌ API Error: ${res.status} - ${error}`)
            throw new SolvaPayError(`Update plan failed (${res.status}): ${error}`, {
              status: res.status,
            })
          }

          return await res.json()
        },
      )
    },

    // DELETE: /v1/sdk/products/{productRef}/plans/{planRef}
    async deletePlan(productRef, planRef) {
      return dispatchClient('deletePlan', { productRef, planRef }, async () => {
        const url = `${base}/v1/sdk/products/${productRef}/plans/${planRef}`

        const res = await fetch(url, {
          method: 'DELETE',
          headers,
        })

        if (!res.ok && res.status !== 404) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Delete plan failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }
      })
    },

    // POST: /payment-intents
    async createPaymentIntent(params) {
      return dispatchClient('createPaymentIntent', params, async () => {
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
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create payment intent failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // POST: /v1/sdk/payment-intents (purpose: credit_topup)
    async createTopupPaymentIntent(params) {
      return dispatchClient('createTopupPaymentIntent', params, async () => {
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
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create topup payment intent failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // POST: /v1/sdk/payment-intents/{paymentIntentId}/process
    async processPaymentIntent(params) {
      return dispatchClient('processPaymentIntent', params, async () => {
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
          throw new SolvaPayError(`Process payment failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return result
      })
    },

    // POST: /v1/sdk/payment-intents/{paymentIntentId}/business-details
    async attachBusinessDetails(params) {
      return dispatchClient('attachBusinessDetails', params, async () => {
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
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Attach business details failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // POST: /v1/sdk/purchases/{purchaseRef}/cancel
    async cancelPurchase(params) {
      return dispatchClient('cancelPurchase', params, async () => {
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
            throw new SolvaPayError(`Purchase not found: ${error}`, { status: 404 })
          }

          if (res.status === 400) {
            throw new SolvaPayError(
              `Purchase cannot be cancelled or does not belong to provider: ${error}`,
              { status: 400 },
            )
          }

          throw new SolvaPayError(`Cancel purchase failed (${res.status}): ${error}`, {
            status: res.status,
          })
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
      })
    },

    // POST: /v1/sdk/purchases/{purchaseRef}/reactivate
    async reactivatePurchase(params) {
      return dispatchClient('reactivatePurchase', params, async () => {
        const url = `${base}/v1/sdk/purchases/${params.purchaseRef}/reactivate`

        const res = await fetch(url, {
          method: 'POST',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)

          if (res.status === 404) {
            throw new SolvaPayError(`Purchase not found: ${error}`, { status: 404 })
          }

          if (res.status === 400) {
            throw new SolvaPayError(`Purchase cannot be reactivated: ${error}`, { status: 400 })
          }

          throw new SolvaPayError(`Reactivate purchase failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const responseText = await res.text()

        let responseData
        try {
          responseData = JSON.parse(responseText)
        } catch (parseError) {
          log(`❌ Failed to parse response as JSON: ${parseError}`)
          throw new SolvaPayError(
            `Invalid JSON response from reactivate purchase endpoint: ${responseText.substring(0, 200)}`,
          )
        }

        if (!responseData || typeof responseData !== 'object') {
          log(`❌ Invalid response structure: ${JSON.stringify(responseData)}`)
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
          log(`❌ Invalid purchase data in response. Full response:`, responseData)
          throw new SolvaPayError(`Invalid purchase data in reactivate purchase response`)
        }

        return result
      })
    },

    // POST: /v1/sdk/user-info
    async getUserInfo(params) {
      return dispatchClient('getUserInfo', params, async () => {
        const url = `${base}/v1/sdk/user-info`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get user info failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // GET: /v1/sdk/customers/:customerRef/balance
    async getCustomerBalance(params) {
      return dispatchClient('getCustomerBalance', params, async () => {
        const url = `${base}/v1/sdk/customers/${params.customerRef}/balance`

        const res = await fetch(url, {
          method: 'GET',
          headers,
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get customer balance failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    // POST: /v1/sdk/checkout-sessions
    async createCheckoutSession(params) {
      return dispatchClient('createCheckoutSession', params, async () => {
        const url = `${base}/v1/sdk/checkout-sessions`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create checkout session failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return result
      })
    },

    // POST: /v1/sdk/customers/customer-sessions
    async createCustomerSession(params) {
      return dispatchClient('createCustomerSession', params, async () => {
        const url = `${base}/v1/sdk/customers/customer-sessions`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Create customer session failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        const result = await res.json()
        return result
      })
    },

    // POST: /v1/sdk/activate
    async activatePlan(params) {
      return dispatchClient('activatePlan', params, async () => {
        const url = `${base}/v1/sdk/activate`

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Activate plan failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    async getPaymentMethod(params) {
      return dispatchClient('getPaymentMethod', params, async () => {
        const url = new URL(`${base}/v1/sdk/payment-method`)
        url.searchParams.set('customerRef', params.customerRef)

        const res = await fetch(url.toString(), { method: 'GET', headers })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get payment method failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    async getAutoRecharge(params) {
      return dispatchClient('getAutoRecharge', params, async () => {
        const url = new URL(`${base}/v1/sdk/auto-recharge`)
        url.searchParams.set('customerRef', params.customerRef)

        const res = await fetch(url.toString(), { method: 'GET', headers })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Get auto-recharge failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    async saveAutoRecharge(params) {
      return dispatchClient('saveAutoRecharge', params, async () => {
        const res = await fetch(`${base}/v1/sdk/auto-recharge`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(params),
        })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Save auto-recharge failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },

    async disableAutoRecharge(params) {
      return dispatchClient('disableAutoRecharge', params, async () => {
        const url = new URL(`${base}/v1/sdk/auto-recharge`)
        url.searchParams.set('customerRef', params.customerRef)

        const res = await fetch(url.toString(), { method: 'DELETE', headers })

        if (!res.ok) {
          const error = await res.text()
          log(`❌ API Error: ${res.status} - ${error}`)
          throw new SolvaPayError(`Disable auto-recharge failed (${res.status}): ${error}`, {
            status: res.status,
          })
        }

        return await res.json()
      })
    },
  }
}
