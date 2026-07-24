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
 * Dynamically load the Node-only `./native` dispatch module.
 *
 * Prefer a relative `./native.js` import first so vitest / plain Node share the
 * same module instance as `setNativeClientForTests`. When a bundler (Next
 * webpack/Turbopack) rewrites that relative specifier into a broken context
 * module, fall back to an absolute `file:` URL resolved via createRequire.
 */
async function importNativeDispatch(): Promise<unknown> {
  const nativeSpecifier = ['./', 'native.js'].join('')
  try {
    return await import(/* webpackIgnore: true */ nativeSpecifier)
  } catch {
    // Bundler rewrote the relative import — resolve from the installed package.
  }

  type NodeModuleBuiltin = {
    createRequire: (filename: string) => { resolve: (id: string) => string }
  }

  const nodeModule = (
    process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => NodeModuleBuiltin | undefined
    }
  ).getBuiltinModule?.('module')

  if (!nodeModule?.createRequire) {
    throw new SolvaPayError(
      'SolvaPay native dispatch module (./native.js) is not available',
    )
  }

  const require = nodeModule.createRequire(`${process.cwd()}/package.json`)
  const serverEntry = require.resolve(['@solvapay/', 'server'].join(''))
  const [{ dirname, join }, { pathToFileURL }] = await Promise.all([
    import('node:path'),
    import('node:url'),
  ])
  const nativeHref = pathToFileURL(join(dirname(serverEntry), 'native.js')).href
  return import(/* webpackIgnore: true */ nativeHref)
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
  if (!opts.apiKey) throw new SolvaPayError('Missing apiKey')

  const nativeConfig = { apiKey: opts.apiKey, apiBaseUrl: opts.apiBaseUrl }

  /**
   * Dispatches a Groups A–C client method to a Rust binding. Rust-only after
   * Step 53 — there is no TypeScript `fetch` fallback. Returns the envelope
   * `value` verbatim (no TS response normalization); HTTP + JSON handling lives
   * entirely in `solvapay_core` (napi `reqwest` / WASM `FetchTransport`).
   *
   * When the resolved implementation is not `rust` (`SOLVAPAY_IMPL=ts`, or the
   * binding is unavailable) this throws instead of silently degrading.
   *
   * Runtime split (both via dynamic import so neither graph statically pulls the
   * other):
   * - Edge (Deno / Workers / edge-light) → `@solvapay/server-wasm` via `./wasm`.
   *   The edge bundle never imports `./native` / `node:module`.
   * - Node → `@solvapay/server-native` via `./native`.
   * - Node vitest with an injected `WasmClient` override → the WASM path (so
   *   `client-wasm-dispatch` / fixtures can exercise edge dispatch under Node
   *   and capture the wire via a stubbed `globalThis.fetch`).
   */
  async function dispatchClient<T>(fn: NativeClientMethod, params: unknown): Promise<T> {
    const argsJson = JSON.stringify(params ?? {})

    // Edge (Deno / Workers / edge-light) — never touch `./native`.
    // Also used under Node vitest when a fake WasmClient override is installed.
    if (!isNodeRuntime()) {
      const wasm = await import('./wasm')
      if (wasm.resolveEdgeImpl('client') !== 'rust') {
        throw new SolvaPayError('server client API not installed')
      }
      return (await wasm.callWasm(fn, argsJson, nativeConfig)) as T
    }

    // Node vitest: injected WasmClient forces the edge dispatch path without
    // requiring a Deno/Workers runtime.
    const wasm = await import('./wasm')
    if (wasm.isWasmClientOverrideActive()) {
      if (wasm.resolveEdgeImpl('client') !== 'rust') {
        throw new SolvaPayError('server client API not installed')
      }
      return (await wasm.callWasm(fn, argsJson, nativeConfig)) as T
    }

    if (!shouldAttemptNativeClient()) {
      throw new SolvaPayError('server client API not installed')
    }
    // Resolve `dist/native.js` via an absolute file URL so Next/webpack/Turbopack
    // cannot rewrite a relative `./native.js` into a broken context module.
    // `webpackIgnore` keeps the dynamic import as a real Node ESM import.
    // The non-literal package/`native.js` join also keeps edge rebundlers from
    // statically pulling this Node-only graph into a Workers bundle.
    const { callNative, resolveImpl } = (await importNativeDispatch()) as {
      callNative: (
        method: NativeClientMethod,
        json: string,
        config: { apiKey: string; apiBaseUrl?: string },
      ) => Promise<unknown>
      resolveImpl: (surface: string) => 'ts' | 'rust'
    }
    if (resolveImpl('client') !== 'rust') {
      throw new SolvaPayError('server client API not installed')
    }
    return (await callNative(fn, argsJson, nativeConfig)) as T
  }

  return {
    async checkLimits(params) {
      return dispatchClient('checkLimits', params)
    },

    async trackUsage(params) {
      return dispatchClient('trackUsage', params)
    },

    async trackUsageBulk(params) {
      return dispatchClient('trackUsageBulk', params)
    },

    async createCustomer(params) {
      return dispatchClient('createCustomer', params)
    },

    // Rust splits path vs body from a single args object (fixture parity).
    async updateCustomer(customerRef, params) {
      return dispatchClient('updateCustomer', { customerRef, ...params })
    },

    async getCustomer(params) {
      return dispatchClient('getCustomer', params)
    },

    async assignCredits(params) {
      return dispatchClient('assignCredits', params)
    },

    async getMerchant() {
      return dispatchClient('getMerchant', {})
    },

    async getPlatformConfig() {
      return dispatchClient('getPlatformConfig', {})
    },

    async getProduct(productRef) {
      return dispatchClient('getProduct', { productRef })
    },

    async listProducts() {
      return dispatchClient('listProducts', {})
    },

    async createProduct(params) {
      return dispatchClient('createProduct', params)
    },

    async bootstrapMcpProduct(params) {
      return dispatchClient('bootstrapMcpProduct', params)
    },

    async configureMcpPlans(productRef, params) {
      return dispatchClient('configureMcpPlans', { productRef, ...params })
    },

    async updateProduct(productRef, params) {
      return dispatchClient('updateProduct', { productRef, ...params })
    },

    async deleteProduct(productRef) {
      return dispatchClient('deleteProduct', { productRef })
    },

    async cloneProduct(productRef, overrides) {
      return dispatchClient('cloneProduct', { productRef, ...(overrides ?? {}) })
    },

    async listPlans(productRef) {
      return dispatchClient('listPlans', { productRef })
    },

    async createPlan(params) {
      return dispatchClient('createPlan', params)
    },

    async updatePlan(productRef, planRef, params) {
      return dispatchClient('updatePlan', { productRef, planRef, ...params })
    },

    async deletePlan(productRef, planRef) {
      return dispatchClient('deletePlan', { productRef, planRef })
    },

    async createPaymentIntent(params) {
      return dispatchClient('createPaymentIntent', params)
    },

    async createTopupPaymentIntent(params) {
      return dispatchClient('createTopupPaymentIntent', params)
    },

    async processPaymentIntent(params) {
      return dispatchClient('processPaymentIntent', params)
    },

    async attachBusinessDetails(params) {
      return dispatchClient('attachBusinessDetails', params)
    },

    async cancelPurchase(params) {
      return dispatchClient('cancelPurchase', params)
    },

    async reactivatePurchase(params) {
      return dispatchClient('reactivatePurchase', params)
    },

    async getUserInfo(params) {
      return dispatchClient('getUserInfo', params)
    },

    async getCustomerBalance(params) {
      return dispatchClient('getCustomerBalance', params)
    },

    async createCheckoutSession(params) {
      return dispatchClient('createCheckoutSession', params)
    },

    async createCustomerSession(params) {
      return dispatchClient('createCustomerSession', params)
    },

    async activatePlan(params) {
      return dispatchClient('activatePlan', params)
    },

    async getPaymentMethod(params) {
      return dispatchClient('getPaymentMethod', params)
    },

    async getAutoRecharge(params) {
      return dispatchClient('getAutoRecharge', params)
    },

    async saveAutoRecharge(params) {
      return dispatchClient('saveAutoRecharge', params)
    },

    async disableAutoRecharge(params) {
      return dispatchClient('disableAutoRecharge', params)
    },
  }
}
