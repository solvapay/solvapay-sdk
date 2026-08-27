/**
 * SolvaPay Server SDK - API Client
 *
 * This module provides the API client implementation for communicating with
 * the SolvaPay backend. The client handles all HTTP requests for paywall
 * protection, usage tracking, and resource management.
 */

import { SolvaPayError } from '@solvapay/core'
import {
  createGeneratedClientOperations,
  type NativeClientMethod,
} from './client.runtime.generated'
import type { SolvaPayClient } from './types'

type WasmClientMethod = Exclude<
  NativeClientMethod,
  'mcpBootstrap' | 'mcpCallBuiltinTool' | 'mcpReadResource' | 'mcpOauthRequest' | 'mcpDispatch'
>

function isWasmClientMethod(fn: NativeClientMethod): fn is WasmClientMethod {
  return (
    fn !== 'mcpBootstrap' &&
    fn !== 'mcpCallBuiltinTool' &&
    fn !== 'mcpReadResource' &&
    fn !== 'mcpOauthRequest' &&
    fn !== 'mcpDispatch'
  )
}

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
  return isNodeRuntime()
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
    throw new SolvaPayError('SolvaPay native dispatch module (./native.js) is not available')
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
   * Missing bindings throw instead of silently degrading.
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
    // MCP composite ops live only on the Node native core (wasm.ts excludes them).
    if (!isNodeRuntime()) {
      if (!isWasmClientMethod(fn)) {
        throw new SolvaPayError(
          `${fn} requires the Node native core; it is not available on the WASM edge client`,
        )
      }
      const wasm = await import('./wasm')
      return (await wasm.callWasm(fn, argsJson, nativeConfig)) as T
    }

    // Node vitest: injected WasmClient forces the edge dispatch path without
    // requiring a Deno/Workers runtime.
    const wasm = await import('./wasm')
    if (wasm.isWasmClientOverrideActive()) {
      if (!isWasmClientMethod(fn)) {
        throw new SolvaPayError(
          `${fn} requires the Node native core; it is not available on the WASM edge client`,
        )
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
    const { callNative } = (await importNativeDispatch()) as {
      callNative: (
        method: NativeClientMethod,
        json: string,
        config: { apiKey: string; apiBaseUrl?: string },
      ) => Promise<unknown>
    }
    return (await callNative(fn, argsJson, nativeConfig)) as T
  }

  return createGeneratedClientOperations(dispatchClient)
}
