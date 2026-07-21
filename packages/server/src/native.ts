/**
 * Node-only loader + JSON-envelope dispatch for `@solvapay/server-native`.
 *
 * Generalizes the Step 37 `webhook-native` pattern for the full-surface
 * Step 37R cutover. Never import this module from `edge.ts` — edge uses
 * `@solvapay/server-wasm` (Step 38).
 */

import { createRequire } from 'node:module'
import { SolvaPayError } from '@solvapay/core'
import { PaywallError } from './paywall'
import type { PaywallStructuredContent } from './types/paywall'
import type { WebhookEvent } from './types/webhook'

export type SolvaPayImpl = 'ts' | 'rust'

/** Surfaces that read `SOLVAPAY_IMPL` independently (per-call). */
export type NativeSurface = 'client' | 'webhook' | string

/** Async methods on the napi `NativeClient` (Groups A + B + C). */
export type NativeClientMethod =
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

export type NativeClientConfig = {
  apiKey: string
  apiBaseUrl?: string
}

export type NativeClientLike = {
  [K in NativeClientMethod]: (argsJson: string) => Promise<string>
}

type NativeClientConstructor = new (
  apiKey: string,
  apiBaseUrl?: string | null,
) => NativeClientLike

/** Sync pure-logic methods on the napi binding (Step 37R-c). */
export type NativeSyncMethod =
  | 'classifyCustomerRef'
  | 'coerceCustomerOptions'
  | 'buildCreateCustomerParams'
  | 'extractBackendCustomerRef'
  | 'classifyLookupError'
  | 'classifyCreateError'
  | 'isEmailConflict'
  | 'validateActivatePlanParams'
  | 'validateCreatePaymentIntentParams'
  | 'validateTopupPaymentIntentParams'
  | 'validateProcessPaymentIntentParams'
  | 'validateAttachBusinessDetailsParams'
  | 'attachBusinessDetailsValidationError'
  | 'projectPaymentIntentResult'
  | 'projectTopupProcessOutcome'
  | 'resolveReturnUrl'
  | 'validateCheckoutSessionParams'
  | 'isCachedCustomerRefValid'
  | 'resolvePurchaseCustomerRef'
  | 'selectActivePurchases'
  | 'classifyCancelError'
  | 'classifyReactivateError'
  | 'normalizeCancelResponse'
  | 'normalizeReactivateResponse'
  | 'validatePurchaseRef'
  | 'projectUsageSnapshot'
  | 'resolveCheckLimitsParams'
  | 'validateListPlansParams'
  | 'isErrorResult'
  | 'mapRouteError'
  | 'validateGetProductParams'
  | 'resolveProductRef'
  | 'evaluateCachedLimits'
  | 'evaluateFreshLimits'
  | 'decidePaywallOutcome'
  | 'resolveFallbackGateLimits'
  | 'classifyPaywallState'
  | 'buildGateMessage'
  | 'buildNudgeMessage'
  | 'buildPaywallGate'
  | 'paywallErrorToClientPayload'
  | 'retryNextDelayMs'
  // Step 37R-d — @solvapay/core pure logic
  | 'validateBusinessDetails'
  | 'deriveTaxIdType'
  | 'resolveTaxBehavior'
  | 'getTaxIdExample'
  | 'getTaxIdFieldLabel'
  | 'getTaxIdHelperText'
  | 'getBusinessCountryOptions'
  | 'creditsToDisplayMinorUnits'
  | 'isZeroDecimalCurrency'
  | 'minorUnitsPerMajor'
  | 'resolveSellerIdentityDisplay'
  | 'getSellerTaxIdentifierDisplayLabel'
  | 'SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE'
  // Step 37R-d — @solvapay/mcp-core builders (+ formatGate shares paywallToolResult)
  | 'paywallToolResult'
  | 'makeResponseResult'
  | 'assertResponseResult'
  | 'MCP_TOOL_NAMES'
  | 'mcpViewMaps'
  | 'deriveIcons'
  | 'buildToolDescriptorMetadata'
  | 'buildPromptDescriptorMetadata'
  | 'buildPromptUserMessage'
  | 'validatePublicBaseUrl'

export type NativeBinding = {
  verifyWebhook(body: string, signature: string, secret: string): string
  NativeClient?: NativeClientConstructor
  napiVersion?: () => string
} & Partial<Record<NativeSyncMethod, (argsJson: string) => string>>

type EnvelopeOk = { ok: true; value: unknown }
type EnvelopeErr = {
  ok: false
  error: {
    kind: string
    message: string
    status?: number | null
    code?: string | null
    gate?: unknown
    retryable?: boolean
  }
}
type Envelope = EnvelopeOk | EnvelopeErr

const require = createRequire(import.meta.url)

/** `undefined` = not attempted; `null` = load failed; otherwise the binding. */
let cachedBinding: NativeBinding | null | undefined

/**
 * When set (unit tests), skips `createRequire` — vitest `vi.mock` does not
 * intercept Node's `createRequire` loader, so tests inject a fake binding here.
 * `undefined` means "use real load".
 */
let bindingOverride: NativeBinding | null | undefined

/** Injected fake client for unit tests (`undefined` = construct from binding). */
let clientOverride: NativeClientLike | null | undefined

/** Cache of real `NativeClient` instances keyed by config. */
const clientCache = new Map<string, NativeClientLike>()

function configKey(config: NativeClientConfig): string {
  return `${config.apiKey}\0${config.apiBaseUrl ?? ''}`
}

/**
 * Clears binding + client caches. Used by unit tests that flip mocks / env.
 * @internal
 */
export function resetNativeCache(): void {
  cachedBinding = undefined
  bindingOverride = undefined
  clientOverride = undefined
  clientCache.clear()
}

/**
 * Injects a fake native binding for unit tests.
 * @internal
 */
export function setNativeBindingForTests(binding: NativeBinding | null): void {
  bindingOverride = binding
  cachedBinding = undefined
  clientCache.clear()
}

/**
 * Injects a fake `NativeClient` for unit tests (skips constructor).
 * @internal
 */
export function setNativeClientForTests(client: NativeClientLike | null): void {
  clientOverride = client
  clientCache.clear()
}

/**
 * Loads `@solvapay/server-native` once (or returns the test override).
 */
export function loadNativeBinding(): NativeBinding | null {
  if (bindingOverride !== undefined) {
    return bindingOverride
  }
  if (cachedBinding !== undefined) {
    return cachedBinding
  }
  try {
    cachedBinding = require('@solvapay/server-native') as NativeBinding
  } catch {
    cachedBinding = null
  }
  return cachedBinding
}

/**
 * Selects the implementation for a cut-over surface.
 *
 * - `SOLVAPAY_IMPL=ts` — force TypeScript
 * - `SOLVAPAY_IMPL=rust` — force the napi binding (surfaces load errors)
 * - unset — prefer rust when the binding loads, else silent TS fallback
 *
 * `surface` is reserved for future per-surface env overrides; today every
 * surface shares `SOLVAPAY_IMPL` (read per call).
 */
export function resolveImpl(_surface: NativeSurface): SolvaPayImpl {
  const flag = process.env.SOLVAPAY_IMPL
  if (flag === 'ts') return 'ts'
  if (flag === 'rust') return 'rust'
  return loadNativeBinding() ? 'rust' : 'ts'
}

/**
 * Returns a cached napi `NativeClient` for the given config.
 */
export function getNativeClient(config: NativeClientConfig): NativeClientLike {
  if (clientOverride !== undefined && clientOverride !== null) {
    return clientOverride
  }
  if (clientOverride === null) {
    throw new SolvaPayError(
      'SolvaPay native binding (@solvapay/server-native) is not available',
    )
  }

  const key = configKey(config)
  const cached = clientCache.get(key)
  if (cached) return cached

  const binding = loadNativeBinding()
  if (binding === null || binding.NativeClient === undefined) {
    throw new SolvaPayError(
      'SolvaPay native binding (@solvapay/server-native) is not available',
    )
  }

  const client = new binding.NativeClient(config.apiKey, config.apiBaseUrl ?? null)
  clientCache.set(key, client)
  return client
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  if (!('ok' in value)) return false
  return (value as { ok: unknown }).ok === true || (value as { ok: unknown }).ok === false
}

/**
 * Maps a JSON envelope error to the frozen TypeScript error classes.
 */
export function reconstructEnvelopeError(error: EnvelopeErr['error']): Error {
  switch (error.kind) {
    case 'Paywall':
      return new PaywallError(
        error.message,
        error.gate as PaywallStructuredContent,
      )
    case 'Api': {
      const init: { status?: number; code?: string } = {}
      if (typeof error.status === 'number') init.status = error.status
      if (typeof error.code === 'string') init.code = error.code
      return new SolvaPayError(error.message, init)
    }
    case 'Webhook':
    case 'Transport':
    default:
      return new SolvaPayError(error.message)
  }
}

/**
 * Parses a JSON envelope string and returns `value` or throws reconstructed errors.
 */
function unwrapEnvelope(envelopeJson: string): unknown {
  let envelope: unknown
  try {
    envelope = JSON.parse(envelopeJson) as unknown
  } catch {
    throw new SolvaPayError('SolvaPay native binding returned invalid JSON envelope')
  }

  if (!isEnvelope(envelope)) {
    throw new SolvaPayError('SolvaPay native binding returned malformed envelope')
  }

  if (envelope.ok) {
    return envelope.value
  }
  throw reconstructEnvelopeError(envelope.error)
}

/**
 * Calls a napi `NativeClient` method and reconstructs the envelope.
 *
 * Success returns the envelope `value` verbatim (no TS re-normalization).
 * Failure throws `SolvaPayError` / `PaywallError`.
 */
export async function callNative(
  fn: NativeClientMethod,
  argsJson: string,
  config: NativeClientConfig,
): Promise<unknown> {
  const client = getNativeClient(config)
  const method = client[fn]
  if (typeof method !== 'function') {
    throw new SolvaPayError(`SolvaPay native client missing method: ${fn}`)
  }

  let envelopeJson: string
  try {
    envelopeJson = await method.call(client, argsJson)
  } catch (err) {
    if (err instanceof SolvaPayError || err instanceof PaywallError) {
      throw err
    }
    throw new SolvaPayError(err instanceof Error ? err.message : String(err))
  }

  return unwrapEnvelope(envelopeJson)
}

/**
 * Calls a sync top-level napi pure-logic function and reconstructs the envelope.
 *
 * Success returns the envelope `value` verbatim (no TS re-normalization).
 * Failure throws `SolvaPayError` / `PaywallError`.
 */
export function callNativeSync(fn: NativeSyncMethod, argsJson: string): unknown {
  const binding = loadNativeBinding()
  if (binding === null) {
    throw new SolvaPayError(
      'SolvaPay native binding (@solvapay/server-native) is not available',
    )
  }

  const method = binding[fn]
  if (typeof method !== 'function') {
    throw new SolvaPayError(`SolvaPay native binding missing sync method: ${fn}`)
  }

  let envelopeJson: string
  try {
    envelopeJson = method(argsJson)
  } catch (err) {
    if (err instanceof SolvaPayError || err instanceof PaywallError) {
      throw err
    }
    throw new SolvaPayError(err instanceof Error ? err.message : String(err))
  }

  return unwrapEnvelope(envelopeJson)
}

/**
 * Verifies a webhook via `@solvapay/server-native`, rewrapping native errors
 * as {@link SolvaPayError} so public error shape stays unchanged.
 *
 * Webhook path still uses the sync throw-style binding (Step 37); envelope
 * migration for verifyWebhook is deferred.
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
  const binding = loadNativeBinding()
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
