/**
 * Node-only loader + adapter for `@solvapay/server-native`.
 *
 * Never import this module from `edge.ts` — edge uses `@solvapay/server-wasm`
 * (Step 38). This file is Node-only (`createRequire` / `node:module`).
 */

import { createRequire } from 'node:module'
import { SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'

export type WebhookImpl = 'ts' | 'rust'

type NativeBinding = {
  verifyWebhook(body: string, signature: string, secret: string): string
}

const require = createRequire(import.meta.url)

/** `undefined` = not attempted; `null` = load failed; otherwise the binding. */
let cached: NativeBinding | null | undefined

/**
 * When set (unit tests), skips `createRequire` — vitest `vi.mock` does not
 * intercept Node's `createRequire` loader, so tests inject a fake binding here.
 * `undefined` means "use real load".
 */
let bindingOverride: NativeBinding | null | undefined

function loadBinding(): NativeBinding | null {
  if (bindingOverride !== undefined) {
    return bindingOverride
  }
  if (cached !== undefined) {
    return cached
  }
  try {
    cached = require('@solvapay/server-native') as NativeBinding
  } catch {
    cached = null
  }
  return cached
}

/**
 * Clears the cached native binding. Used by unit tests that flip mocks / env.
 * @internal
 */
export function resetWebhookBindingCache(): void {
  cached = undefined
  bindingOverride = undefined
}

/**
 * Injects a fake native binding for unit tests (see `resetWebhookBindingCache`).
 * @internal
 */
export function setWebhookBindingForTests(binding: NativeBinding | null): void {
  bindingOverride = binding
  cached = undefined
}

/**
 * Selects the webhook verification implementation.
 *
 * - `SOLVAPAY_IMPL=ts` — force TypeScript (`node:crypto`)
 * - `SOLVAPAY_IMPL=rust` — force the napi binding (surfaces load errors)
 * - unset — prefer rust when the binding loads, else silent TS fallback
 */
export function resolveWebhookImpl(): WebhookImpl {
  const flag = process.env.SOLVAPAY_IMPL
  if (flag === 'ts') return 'ts'
  if (flag === 'rust') return 'rust'
  return loadBinding() ? 'rust' : 'ts'
}

/**
 * Verifies a webhook via `@solvapay/server-native`, rewrapping native errors
 * as {@link SolvaPayError} so public error shape stays unchanged.
 */
export function verifyWebhookNative({
  body,
  signature,
  secret,
}: {
  body: string
  signature: string
  secret: string
}): WebhookEvent {
  const binding = loadBinding()
  if (binding === null) {
    throw new SolvaPayError(
      'SolvaPay native binding (@solvapay/server-native) is not available',
    )
  }

  try {
    const json = binding.verifyWebhook(body, signature, secret)
    return JSON.parse(json) as WebhookEvent
  } catch (err) {
    if (err instanceof SolvaPayError) {
      throw err
    }
    throw new SolvaPayError(err instanceof Error ? err.message : String(err))
  }
}
