/**
 * Edge/browser adapter for `@solvapay/server-wasm`.
 *
 * Never import the Node napi binding, `node:module`, or `node:crypto` here —
 * this module is part of the edge graph (Deno / Workers / edge-light).
 */

import { SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'

export type EdgeWebhookImpl = 'ts' | 'rust'

type WasmBinding = {
  ready: () => Promise<void>
  verifyWebhook: (
    body: string,
    signature: string,
    secret: string,
    nowUnixSecs: number,
  ) => string
}

/** `undefined` = not attempted; Promise caches in-flight / completed init. */
let initPromise: Promise<WasmBinding> | undefined

/**
 * When set (unit tests), skips dynamic import — vitest mocks are unreliable
 * across generated WASM loaders. `null` forces a load failure.
 */
let bindingOverride: WasmBinding | null | undefined

/**
 * Clears cached WASM init state. Used by unit tests.
 * @internal
 */
export function resetWasmWebhookCache(): void {
  initPromise = undefined
  bindingOverride = undefined
}

/**
 * Injects a fake WASM binding for unit tests.
 * @internal
 */
export function setWasmWebhookBindingForTests(binding: WasmBinding | null): void {
  bindingOverride = binding
  initPromise = undefined
}

/**
 * Reads `SOLVAPAY_IMPL` without importing `node:process`.
 * Supports Node (`process.env`), Deno (`Deno.env`), and missing env (unset).
 */
function readImplFlag(): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process
    const fromProcess = proc?.env?.SOLVAPAY_IMPL
    if (typeof fromProcess === 'string') return fromProcess
  } catch {
    // ignore
  }

  try {
    const deno = (
      globalThis as {
        Deno?: { env?: { get?: (key: string) => string | undefined } }
      }
    ).Deno
    const fromDeno = deno?.env?.get?.('SOLVAPAY_IMPL')
    if (typeof fromDeno === 'string') return fromDeno
  } catch {
    // ignore
  }

  return undefined
}

/**
 * Selects the edge webhook verification implementation.
 *
 * - `SOLVAPAY_IMPL=ts` — force retained Web Crypto TypeScript path
 * - `SOLVAPAY_IMPL=rust` — force WASM (surfaces init errors)
 * - unset — default WASM
 */
export function resolveEdgeWebhookImpl(): EdgeWebhookImpl {
  const flag = readImplFlag()
  if (flag === 'ts') return 'ts'
  return 'rust'
}

function loadWasmBinding(): Promise<WasmBinding> {
  if (bindingOverride !== undefined) {
    if (bindingOverride === null) {
      return Promise.reject(
        new SolvaPayError(
          'SolvaPay WASM binding (@solvapay/server-wasm) is not available',
          { code: 'internal_error' },
        ),
      )
    }
    return Promise.resolve(bindingOverride)
  }

  if (!initPromise) {
    initPromise = import('@solvapay/server-wasm')
      .then(async mod => {
        const binding: WasmBinding = {
          ready: mod.ready,
          verifyWebhook: mod.verifyWebhook,
        }
        await binding.ready()
        return binding
      })
      .catch(err => {
        initPromise = undefined
        if (err instanceof SolvaPayError) throw err
        throw new SolvaPayError(
          err instanceof Error
            ? err.message
            : 'SolvaPay WASM binding (@solvapay/server-wasm) failed to initialize',
          { code: 'internal_error' },
        )
      })
  }
  return initPromise
}

function errorCodeFromUnknown(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/**
 * Verifies a webhook via `@solvapay/server-wasm`, rewrapping errors as
 * {@link SolvaPayError} while preserving snake_case `code` when present.
 */
export async function verifyWebhookWasm({
  body,
  signature,
  secret,
}: {
  body: string
  signature: string
  secret: string
}): Promise<WebhookEvent> {
  const binding = await loadWasmBinding()
  const nowUnixSecs = Math.floor(Date.now() / 1000)

  try {
    const json = binding.verifyWebhook(body, signature, secret, nowUnixSecs)
    try {
      return JSON.parse(json) as WebhookEvent
    } catch {
      throw new SolvaPayError('Invalid webhook payload from WASM binding', {
        code: 'internal_error',
      })
    }
  } catch (err) {
    if (err instanceof SolvaPayError) {
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    const code = errorCodeFromUnknown(err)
    throw new SolvaPayError(message, code !== undefined ? { code } : {})
  }
}
