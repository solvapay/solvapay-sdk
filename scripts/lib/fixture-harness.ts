/**
 * TS golden-fixture harness: injected clock, seeded RNG, mock transport.
 *
 * Replays §5.3 JSON fixtures against `@solvapay/server` and `@solvapay/core`
 * bindings. The SDK itself is unchanged in Phase 0 — host globals are patched
 * for the call and restored in `finally`.
 */

import assert from 'node:assert/strict'
import {
  BUSINESS_COUNTRY_OPTIONS,
  buildCreateCustomerParams,
  classifyCreateError,
  classifyCustomerRef,
  classifyLookupError,
  coerceCustomerOptions,
  creditsToDisplayMinorUnits,
  deriveTaxIdType,
  extractBackendCustomerRef,
  getSellerTaxIdentifierDisplayLabel,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  isEmailConflict,
  isZeroDecimalCurrency,
  minorUnitsPerMajor,
  resolveSellerIdentityDisplay,
  resolveTaxBehavior,
  SolvaPayError,
  attachBusinessDetailsValidationError,
  classifyCancelError,
  classifyReactivateError,
  isCachedCustomerRefValid,
  isErrorResult,
  mapRouteError,
  normalizeCancelResponse,
  normalizeReactivateResponse,
  projectPaymentIntentResult,
  projectTopupProcessOutcome,
  resolvePurchaseCustomerRef,
  resolveReturnUrl,
  projectUsageSnapshot,
  resolveCheckLimitsParams,
  selectActivePurchases,
  validateActivatePlanParams,
  validateAttachBusinessDetailsParams,
  validateBusinessDetails,
  validateCheckoutSessionParams,
  validateCreatePaymentIntentParams,
  validateGetProductParams,
  validateListPlansParams,
  validateProcessPaymentIntentParams,
  validatePurchaseRef,
  validateTopupPaymentIntentParams,
  type UsageSnapshotPurchase,
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  type BusinessDetailsInput,
  type SupportedBusinessCountry,
  type TaxBehavior,
} from '@solvapay/core'
import {
  BALANCE_RECONCILE_DELAYS_MS,
  buildGateMessage,
  buildNudgeMessage,
  buildPaywallGate,
  classifyPaywallState,
  createSolvaPayClient,
  getAuthenticatedUserCore,
  PaywallError,
  paywallErrorToClientPayload,
  pollBalanceUntilIncreased,
  TOPUP_BALANCE_POLL_DELAYS_MS,
  verifyWebhook,
  withRetry,
  type LimitResponseWithPlan,
  type PaywallStructuredContent,
  type PaywallState,
} from '@solvapay/server'
import { verifyWebhook as verifyWebhookEdge } from '@solvapay/server/edge'
import type { Fixture, FixtureErrorExpect, FixtureWire } from './fixture-schema.js'

export type FixtureBinding = {
  /** Distinguishes multiple bindings for the same `input.fn` (e.g. node vs edge). */
  id: string
  invoke: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

export class FixtureRegistry {
  private readonly bindings = new Map<string, FixtureBinding[]>()

  register(fn: string, binding: FixtureBinding): void {
    const list = this.bindings.get(fn) ?? []
    list.push(binding)
    this.bindings.set(fn, list)
  }

  get(fn: string): FixtureBinding[] {
    const list = this.bindings.get(fn)
    if (!list || list.length === 0) {
      throw new Error(`No binding registered for fn: ${fn}`)
    }
    return list
  }
}

/** Deterministic PRNG used to stabilize `Math.random()` under fixtures. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type ReplayOptions = {
  registry: FixtureRegistry
}

type CapturedRequest = {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: unknown
}

type GlobalSnapshot = {
  dateNow: typeof Date.now
  mathRandom: typeof Math.random
  fetch: typeof globalThis.fetch
  setTimeout: typeof globalThis.setTimeout
}

function snapshotGlobals(): GlobalSnapshot {
  return {
    dateNow: Date.now,
    mathRandom: Math.random,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
  }
}

function restoreGlobals(snapshot: GlobalSnapshot): void {
  Date.now = snapshot.dateNow
  Math.random = snapshot.mathRandom
  globalThis.fetch = snapshot.fetch
  globalThis.setTimeout = snapshot.setTimeout
}

/**
 * Patch `globalThis.setTimeout` to record each delay and fire immediately.
 * Fixtures assert the computed delay sequence, never wall-clock time.
 */
export function installDelayRecorder(onSleep: (ms: number) => void): {
  delays: number[]
  restore: () => void
} {
  const delays: number[] = []
  const original = globalThis.setTimeout
  // Fire immediately: assert the computed delay, never wall-clock (step 5 gotcha).
  // Narrow callback shape matches withRetry's sleep(); cast restores setTimeout's full type.
  globalThis.setTimeout = ((cb: () => void, ms?: number) => {
    const delay = ms ?? 0
    delays.push(delay)
    onSleep(delay)
    cb()
    return 0
  }) as typeof globalThis.setTimeout
  return {
    delays,
    restore: () => {
      globalThis.setTimeout = original
    },
  }
}

function patchClock(clock: string): void {
  const clockMs = Date.parse(clock)
  if (Number.isNaN(clockMs)) {
    throw new Error(`Invalid fixture clock: ${clock}`)
  }
  Date.now = () => clockMs
}

function patchRng(seed: number): void {
  const next = mulberry32(seed)
  Math.random = () => next()
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = value
    }
    return out
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = value
    }
  }
  return out
}

function parseBody(raw: BodyInit | null | undefined): unknown {
  if (raw == null || raw === '') return undefined
  if (typeof raw !== 'string') {
    throw new Error('Fixture harness mock transport only supports string request bodies')
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function searchParamsToRecord(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  params.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function wireResponseBody(body: unknown): BodyInit | null {
  // null/undefined → empty body (needed for 204 and void DELETE success).
  if (body === null || body === undefined) return null
  // Plain strings must stay verbatim so error `{body}` substitution and
  // cancel/reactivate invalid-JSON branches see the exact text.
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

function installMockFetch(wire: FixtureWire, onCapture: (request: CapturedRequest) => void): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    onCapture({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query: searchParamsToRecord(url.searchParams),
      headers: headersToRecord(init?.headers),
      body: parseBody(init?.body ?? null),
    })
    return new Response(wireResponseBody(wire.response.body), {
      status: wire.response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

function assertWireRequest(actual: CapturedRequest, expected: FixtureWire['request']): void {
  assert.equal(actual.method, expected.method, 'wire.request.method mismatch')
  assert.equal(actual.path, expected.path, 'wire.request.path mismatch')

  if (expected.query !== undefined) {
    assert.deepEqual(actual.query, expected.query, 'wire.request.query mismatch')
  }

  if (expected.headers) {
    const actualNorm = new Map(Object.entries(actual.headers).map(([k, v]) => [k.toLowerCase(), v]))
    for (const [key, value] of Object.entries(expected.headers)) {
      assert.equal(
        actualNorm.get(key.toLowerCase()),
        value,
        `wire.request.headers[${key}] mismatch`,
      )
    }
  }

  if (expected.body !== undefined) {
    assert.deepEqual(actual.body, expected.body, 'wire.request.body mismatch')
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Reflect.get(error, 'status')
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

function assertExpectedError(error: unknown, expected: FixtureErrorExpect): void {
  if (!(error instanceof Error)) {
    throw new Error(`Fixture expected Error but binding threw non-Error: ${String(error)}`)
  }

  if (expected.name !== undefined) {
    assert.equal(error.name, expected.name, 'expect.error.name mismatch')
  }
  assert.equal(error.message, expected.message, 'expect.error.message mismatch')

  if (expected.status !== undefined) {
    assert.equal(getErrorStatus(error), expected.status, 'expect.error.status mismatch')
  }
}

/**
 * Fixture JSON is schema-validated; this is the single documented cast into
 * the SDK method's parameter type (avoids 36 ad-hoc assertions).
 */
function coerceArgs<T>(args: Record<string, unknown>): T {
  return args as T
}

function reqStr(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string') {
    throw new Error(`Expected args.${key} to be a string`)
  }
  return value
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`Expected args.${key} to be a string when present`)
  }
  return value
}

function omitKeys(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }
  for (const key of keys) {
    delete out[key]
  }
  return out
}

function isVerifyWebhookArgs(
  args: Record<string, unknown>,
): args is { body: string; signature: string; secret: string } {
  return (
    typeof args.body === 'string' &&
    typeof args.signature === 'string' &&
    typeof args.secret === 'string'
  )
}

const PAYWALL_STATE_KINDS = [
  'activation_required',
  'topup_required',
  'upgrade_required',
  'reactivation_required',
] as const

const PAYWALL_GATE_KINDS = ['payment_required', 'activation_required'] as const

function isPaywallState(value: unknown): value is PaywallState {
  if (typeof value !== 'object' || value === null) return false
  const kind = Reflect.get(value, 'kind')
  return typeof kind === 'string' && (PAYWALL_STATE_KINDS as readonly string[]).includes(kind)
}

function isPaywallStructuredContentValue(value: unknown): value is PaywallStructuredContent {
  if (typeof value !== 'object' || value === null) return false
  const kind = Reflect.get(value, 'kind')
  return (
    typeof kind === 'string' &&
    (PAYWALL_GATE_KINDS as readonly string[]).includes(kind) &&
    typeof Reflect.get(value, 'product') === 'string' &&
    typeof Reflect.get(value, 'checkoutUrl') === 'string' &&
    typeof Reflect.get(value, 'message') === 'string'
  )
}

function isLimitsOrNull(value: unknown): value is LimitResponseWithPlan | null {
  return value === null || (typeof value === 'object' && value !== null)
}

function isClassifyPaywallStateArgs(
  args: Record<string, unknown>,
): args is { limits: LimitResponseWithPlan | null } {
  return 'limits' in args && isLimitsOrNull(args.limits)
}

/** `buildPaywallGate` accepts LimitResponse-shaped objects; `plan` may be absent. */
type LimitsLikeArgs = Omit<LimitResponseWithPlan, 'plan'> & { plan?: string }

function isBuildPaywallGateArgs(
  args: Record<string, unknown>,
): args is { productRef: string; limits: LimitsLikeArgs } {
  return (
    typeof args.productRef === 'string' && typeof args.limits === 'object' && args.limits !== null
  )
}

function isBuildGateMessageArgs(
  args: Record<string, unknown>,
): args is { state: PaywallState; gate: PaywallStructuredContent } {
  return isPaywallState(args.state) && isPaywallStructuredContentValue(args.gate)
}

function isBuildNudgeMessageArgs(
  args: Record<string, unknown>,
): args is { state: PaywallState; limits: LimitResponseWithPlan | null } {
  return isPaywallState(args.state) && isLimitsOrNull(args.limits)
}

function isPaywallErrorToClientPayloadArgs(
  args: Record<string, unknown>,
): args is { message: string; structuredContent: PaywallStructuredContent } {
  return typeof args.message === 'string' && isPaywallStructuredContentValue(args.structuredContent)
}

function isBusinessDetailsInput(args: Record<string, unknown>): args is BusinessDetailsInput {
  return typeof args.isBusiness === 'boolean'
}

function isCountryArg(args: Record<string, unknown>): args is { country: SupportedBusinessCountry } {
  return typeof args.country === 'string'
}

function isResolveTaxBehaviorArgs(
  args: Record<string, unknown>,
): args is { behavior: TaxBehavior; currency: string } {
  return typeof args.behavior === 'string' && typeof args.currency === 'string'
}

function isCurrencyArg(args: Record<string, unknown>): args is { currency: string } {
  return typeof args.currency === 'string'
}

function isCreditsToDisplayArgs(args: Record<string, unknown>): args is {
  credits: number
  creditsPerMinorUnit: number
  displayExchangeRate: number
  displayCurrency: string
} {
  return (
    typeof args.credits === 'number' &&
    typeof args.creditsPerMinorUnit === 'number' &&
    typeof args.displayExchangeRate === 'number' &&
    typeof args.displayCurrency === 'string'
  )
}

function isOptionalCountryArg(
  args: Record<string, unknown>,
): args is { country?: string | null } {
  return args.country === undefined || args.country === null || typeof args.country === 'string'
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isResolveSellerIdentityArgs(args: Record<string, unknown>): args is {
  country?: string | null
  vatNumber?: string | null
  taxId?: string | null
  companyNumber?: string | null
} {
  return (
    isOptionalStringOrNull(args.country) &&
    isOptionalStringOrNull(args.vatNumber) &&
    isOptionalStringOrNull(args.taxId) &&
    isOptionalStringOrNull(args.companyNumber)
  )
}

type RetryAttemptSpec = { resolve: unknown } | { throw: string } | { throwRaw: unknown }

type RetryShouldRetrySpec = 'always' | 'never' | { vetoAt: number[] }

type RetryOptionsSpec = {
  maxRetries?: number
  initialDelay?: number
  backoffStrategy?: 'fixed' | 'linear' | 'exponential'
}

type WithRetryScenario = {
  attempts: RetryAttemptSpec[]
  options?: RetryOptionsSpec
  shouldRetry?: RetryShouldRetrySpec
  onRetry?: true
}

function isRetryAttemptSpec(value: unknown): value is RetryAttemptSpec {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  if ('resolve' in value) return true
  if ('throw' in value) return typeof Reflect.get(value, 'throw') === 'string'
  if ('throwRaw' in value) return true
  return false
}

function isRetryShouldRetrySpec(value: unknown): value is RetryShouldRetrySpec {
  if (value === 'always' || value === 'never') return true
  if (typeof value !== 'object' || value === null) return false
  if (!('vetoAt' in value)) return false
  const vetoAt = Reflect.get(value, 'vetoAt')
  return Array.isArray(vetoAt) && vetoAt.every(n => typeof n === 'number')
}

function isRetryOptionsSpec(value: unknown): value is RetryOptionsSpec {
  if (typeof value !== 'object' || value === null) return false
  const maxRetries = Reflect.get(value, 'maxRetries')
  const initialDelay = Reflect.get(value, 'initialDelay')
  const backoffStrategy = Reflect.get(value, 'backoffStrategy')
  return (
    (maxRetries === undefined || typeof maxRetries === 'number') &&
    (initialDelay === undefined || typeof initialDelay === 'number') &&
    (backoffStrategy === undefined ||
      backoffStrategy === 'fixed' ||
      backoffStrategy === 'linear' ||
      backoffStrategy === 'exponential')
  )
}

function isWithRetryScenario(args: Record<string, unknown>): args is WithRetryScenario {
  if (!Array.isArray(args.attempts) || !args.attempts.every(isRetryAttemptSpec)) {
    return false
  }
  if (args.options !== undefined && !isRetryOptionsSpec(args.options)) {
    return false
  }
  if (args.shouldRetry !== undefined && !isRetryShouldRetrySpec(args.shouldRetry)) {
    return false
  }
  if (args.onRetry !== undefined && args.onRetry !== true) {
    return false
  }
  return true
}

type BalancePollObservation = { credits: number } | { throw: string }

type BalancePollScenario = {
  baseline: number
  observations: BalancePollObservation[]
  delays?: 'topup' | 'reconcile' | number[]
}

function isBalancePollObservation(value: unknown): value is BalancePollObservation {
  if (typeof value !== 'object' || value === null) return false
  if ('credits' in value && typeof Reflect.get(value, 'credits') === 'number') {
    return !('throw' in value)
  }
  if ('throw' in value && typeof Reflect.get(value, 'throw') === 'string') {
    return !('credits' in value)
  }
  return false
}

function isBalancePollScenario(args: Record<string, unknown>): args is BalancePollScenario {
  if (typeof args.baseline !== 'number') return false
  if (!Array.isArray(args.observations) || !args.observations.every(isBalancePollObservation)) {
    return false
  }
  if (args.delays === undefined) return true
  if (args.delays === 'topup' || args.delays === 'reconcile') return true
  return Array.isArray(args.delays) && args.delays.every(n => typeof n === 'number')
}

function resolveBalancePollDelays(
  delays: BalancePollScenario['delays'],
): readonly number[] | undefined {
  if (delays === undefined) return undefined
  if (delays === 'topup') return TOPUP_BALANCE_POLL_DELAYS_MS
  if (delays === 'reconcile') return BALANCE_RECONCILE_DELAYS_MS
  return delays
}

function formatCallEvent(attempt: number): string {
  return `call:${attempt}`
}

function formatShouldRetryEvent(attempt: number, result: boolean): string {
  return `shouldRetry:${attempt}=${result}`
}

function formatOnRetryEvent(attempt: number): string {
  return `onRetry:${attempt}`
}

function formatSleepEvent(ms: number): string {
  return `sleep:${ms}`
}

function resolveShouldRetry(
  spec: RetryShouldRetrySpec,
): (error: Error, attempt: number) => boolean {
  if (spec === 'always') return () => true
  if (spec === 'never') return () => false
  const vetoAt = new Set(spec.vetoAt)
  return (_error, attempt) => !vetoAt.has(attempt)
}

function buildScenario(scenario: WithRetryScenario, events: string[]) {
  let callIndex = 0

  const fn = async (): Promise<unknown> => {
    const attempt = callIndex
    events.push(formatCallEvent(attempt))
    const spec = scenario.attempts[callIndex]
    callIndex += 1
    if (spec === undefined) {
      throw new Error(`withRetry scenario exhausted attempts at call:${attempt}`)
    }
    if ('resolve' in spec) return spec.resolve
    if ('throw' in spec) throw new Error(spec.throw)
    throw spec.throwRaw
  }

  const options: {
    maxRetries?: number
    initialDelay?: number
    backoffStrategy?: 'fixed' | 'linear' | 'exponential'
    shouldRetry?: (error: Error, attempt: number) => boolean
    onRetry?: (error: Error, attempt: number) => void
  } = { ...scenario.options }

  if (scenario.shouldRetry !== undefined) {
    const decide = resolveShouldRetry(scenario.shouldRetry)
    options.shouldRetry = (error, attempt) => {
      const result = decide(error, attempt)
      events.push(formatShouldRetryEvent(attempt, result))
      return result
    }
  }

  if (scenario.onRetry === true) {
    options.onRetry = (_error, attempt) => {
      events.push(formatOnRetryEvent(attempt))
    }
  }

  return { fn, options }
}

/** Frozen webhook messages (manifest `errors.webhook.messages`). */
const WEBHOOK_MESSAGES: Record<string, string> = {
  missing_signature: 'Missing webhook signature',
  malformed_signature: 'Malformed webhook signature',
  timestamp_too_old: 'Webhook signature timestamp too old',
  invalid_signature: 'Invalid webhook signature',
  invalid_payload: 'Invalid webhook payload: body is not valid JSON',
}

/** Substitutes `{name}` placeholders (parity with Rust `render_template`). */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  )
}

function constructSdkErrorFromArgs(args: Record<string, unknown>): never {
  const kind = args.kind
  if (kind === 'Api') {
    if (typeof args.template !== 'string') {
      throw new Error('constructSdkError Api args.template must be a string')
    }
    const varsRaw = args.vars
    const vars: Record<string, string> = {}
    if (varsRaw !== undefined && varsRaw !== null) {
      if (typeof varsRaw !== 'object' || Array.isArray(varsRaw)) {
        throw new Error('constructSdkError Api args.vars must be an object')
      }
      for (const [key, value] of Object.entries(varsRaw as Record<string, unknown>)) {
        if (typeof value === 'string') vars[key] = value
        else if (typeof value === 'number') vars[key] = String(value)
        else throw new Error(`constructSdkError Api args.vars.${key} must be string or number`)
      }
    }
    const status = typeof args.status === 'number' ? args.status : undefined
    const code = typeof args.code === 'string' ? args.code : undefined
    throw new SolvaPayError(renderTemplate(args.template, vars), { status, code })
  }

  if (kind === 'Webhook') {
    if (typeof args.code !== 'string') {
      throw new Error('constructSdkError Webhook args.code must be a string')
    }
    const message = WEBHOOK_MESSAGES[args.code]
    if (message === undefined) {
      throw new Error(`constructSdkError unknown webhook code: ${args.code}`)
    }
    throw new SolvaPayError(message, { code: args.code })
  }

  if (kind === 'Paywall') {
    if (typeof args.message !== 'string') {
      throw new Error('constructSdkError Paywall args.message must be a string')
    }
    if (args.gate === undefined || typeof args.gate !== 'object' || args.gate === null) {
      throw new Error('constructSdkError Paywall args.gate must be an object')
    }
    throw new PaywallError(args.message, args.gate as PaywallStructuredContent)
  }

  if (kind === 'Transport') {
    if (typeof args.message !== 'string') {
      throw new Error('constructSdkError Transport args.message must be a string')
    }
    if (typeof args.retryable !== 'boolean') {
      throw new Error('constructSdkError Transport args.retryable must be a boolean')
    }
    throw new SolvaPayError(args.message, {
      code: args.retryable ? 'retryable' : 'non_retryable',
    })
  }

  throw new Error(
    `constructSdkError args.kind must be Api|Webhook|Paywall|Transport, got ${String(kind)}`,
  )
}

/** Registers default SDK bindings (webhook, client, retry, paywall, core helpers). */
export function createDefaultRegistry(): FixtureRegistry {
  const registry = new FixtureRegistry()

  registry.register('constructSdkError', {
    id: 'ts',
    invoke: args => constructSdkErrorFromArgs(args),
  })

  registry.register('verifyWebhook', {
    id: 'node',
    invoke: args => {
      if (!isVerifyWebhookArgs(args)) {
        throw new Error('verifyWebhook args must include string body, signature, and secret')
      }
      return verifyWebhook(args)
    },
  })

  registry.register('verifyWebhook', {
    id: 'edge',
    invoke: args => {
      if (!isVerifyWebhookArgs(args)) {
        throw new Error('verifyWebhook args must include string body, signature, and secret')
      }
      return verifyWebhookEdge(args)
    },
  })

  const client = createSolvaPayClient({
    apiKey: 'sk_test_fixture',
    apiBaseUrl: 'https://api.solvapay.com',
  })

  const registerClient = (
    fn: string,
    invoke: (args: Record<string, unknown>) => unknown | Promise<unknown>,
  ): void => {
    registry.register(fn, { id: 'client', invoke })
  }

  registerClient('checkLimits', args => {
    if (!client.checkLimits) throw new Error('checkLimits is not available on SolvaPayClient')
    return client.checkLimits(coerceArgs(args))
  })
  registerClient('trackUsage', args => {
    if (!client.trackUsage) throw new Error('trackUsage is not available on SolvaPayClient')
    return client.trackUsage(coerceArgs(args))
  })
  registerClient('trackUsageBulk', args => {
    if (!client.trackUsageBulk) throw new Error('trackUsageBulk is not available on SolvaPayClient')
    return client.trackUsageBulk(coerceArgs(args))
  })
  registerClient('createCustomer', args => {
    if (!client.createCustomer) throw new Error('createCustomer is not available on SolvaPayClient')
    return client.createCustomer(coerceArgs(args))
  })
  registerClient('updateCustomer', args => {
    if (!client.updateCustomer) throw new Error('updateCustomer is not available on SolvaPayClient')
    return client.updateCustomer(
      reqStr(args, 'customerRef'),
      coerceArgs(omitKeys(args, ['customerRef'])),
    )
  })
  registerClient('getCustomer', args => {
    if (!client.getCustomer) throw new Error('getCustomer is not available on SolvaPayClient')
    return client.getCustomer(coerceArgs(args))
  })
  registerClient('assignCredits', args => {
    if (!client.assignCredits) throw new Error('assignCredits is not available on SolvaPayClient')
    return client.assignCredits(coerceArgs(args))
  })
  registerClient('getMerchant', () => {
    if (!client.getMerchant) throw new Error('getMerchant is not available on SolvaPayClient')
    return client.getMerchant()
  })
  registerClient('getPlatformConfig', () => {
    if (!client.getPlatformConfig) {
      throw new Error('getPlatformConfig is not available on SolvaPayClient')
    }
    return client.getPlatformConfig()
  })
  registerClient('getProduct', args => {
    if (!client.getProduct) throw new Error('getProduct is not available on SolvaPayClient')
    return client.getProduct(reqStr(args, 'productRef'))
  })
  registerClient('listProducts', () => {
    if (!client.listProducts) throw new Error('listProducts is not available on SolvaPayClient')
    return client.listProducts()
  })
  registerClient('createProduct', args => {
    if (!client.createProduct) throw new Error('createProduct is not available on SolvaPayClient')
    return client.createProduct(coerceArgs(args))
  })
  registerClient('bootstrapMcpProduct', args => {
    if (!client.bootstrapMcpProduct) {
      throw new Error('bootstrapMcpProduct is not available on SolvaPayClient')
    }
    return client.bootstrapMcpProduct(coerceArgs(args))
  })
  registerClient('configureMcpPlans', args => {
    if (!client.configureMcpPlans) {
      throw new Error('configureMcpPlans is not available on SolvaPayClient')
    }
    return client.configureMcpPlans(
      reqStr(args, 'productRef'),
      coerceArgs(omitKeys(args, ['productRef'])),
    )
  })
  registerClient('updateProduct', args => {
    if (!client.updateProduct) throw new Error('updateProduct is not available on SolvaPayClient')
    return client.updateProduct(
      reqStr(args, 'productRef'),
      coerceArgs(omitKeys(args, ['productRef'])),
    )
  })
  registerClient('deleteProduct', async args => {
    if (!client.deleteProduct) throw new Error('deleteProduct is not available on SolvaPayClient')
    await client.deleteProduct(reqStr(args, 'productRef'))
    return null
  })
  registerClient('cloneProduct', args => {
    if (!client.cloneProduct) throw new Error('cloneProduct is not available on SolvaPayClient')
    const name = optStr(args, 'name')
    return client.cloneProduct(
      reqStr(args, 'productRef'),
      name !== undefined ? { name } : undefined,
    )
  })
  registerClient('listPlans', args => {
    if (!client.listPlans) throw new Error('listPlans is not available on SolvaPayClient')
    return client.listPlans(reqStr(args, 'productRef'))
  })
  registerClient('createPlan', args => {
    if (!client.createPlan) throw new Error('createPlan is not available on SolvaPayClient')
    return client.createPlan(coerceArgs(args))
  })
  registerClient('updatePlan', args => {
    if (!client.updatePlan) throw new Error('updatePlan is not available on SolvaPayClient')
    return client.updatePlan(
      reqStr(args, 'productRef'),
      reqStr(args, 'planRef'),
      coerceArgs(omitKeys(args, ['productRef', 'planRef'])),
    )
  })
  registerClient('deletePlan', async args => {
    if (!client.deletePlan) throw new Error('deletePlan is not available on SolvaPayClient')
    await client.deletePlan(reqStr(args, 'productRef'), reqStr(args, 'planRef'))
    return null
  })
  registerClient('createPaymentIntent', args => {
    if (!client.createPaymentIntent) {
      throw new Error('createPaymentIntent is not available on SolvaPayClient')
    }
    return client.createPaymentIntent(coerceArgs(args))
  })
  registerClient('createTopupPaymentIntent', args => {
    if (!client.createTopupPaymentIntent) {
      throw new Error('createTopupPaymentIntent is not available on SolvaPayClient')
    }
    return client.createTopupPaymentIntent(coerceArgs(args))
  })
  registerClient('cancelPurchase', args => {
    if (!client.cancelPurchase) throw new Error('cancelPurchase is not available on SolvaPayClient')
    return client.cancelPurchase(coerceArgs(args))
  })
  registerClient('reactivatePurchase', args => {
    if (!client.reactivatePurchase) {
      throw new Error('reactivatePurchase is not available on SolvaPayClient')
    }
    return client.reactivatePurchase(coerceArgs(args))
  })
  registerClient('processPaymentIntent', args => {
    if (!client.processPaymentIntent) {
      throw new Error('processPaymentIntent is not available on SolvaPayClient')
    }
    return client.processPaymentIntent(coerceArgs(args))
  })
  registerClient('attachBusinessDetails', args => {
    if (!client.attachBusinessDetails) {
      throw new Error('attachBusinessDetails is not available on SolvaPayClient')
    }
    return client.attachBusinessDetails(coerceArgs(args))
  })
  registerClient('getUserInfo', args => {
    if (!client.getUserInfo) throw new Error('getUserInfo is not available on SolvaPayClient')
    return client.getUserInfo(coerceArgs(args))
  })
  registerClient('getCustomerBalance', args => {
    if (!client.getCustomerBalance) {
      throw new Error('getCustomerBalance is not available on SolvaPayClient')
    }
    return client.getCustomerBalance(coerceArgs(args))
  })
  registerClient('createCheckoutSession', args => {
    if (!client.createCheckoutSession) {
      throw new Error('createCheckoutSession is not available on SolvaPayClient')
    }
    return client.createCheckoutSession(coerceArgs(args))
  })
  registerClient('createCustomerSession', args => {
    if (!client.createCustomerSession) {
      throw new Error('createCustomerSession is not available on SolvaPayClient')
    }
    return client.createCustomerSession(coerceArgs(args))
  })
  registerClient('activatePlan', args => {
    if (!client.activatePlan) throw new Error('activatePlan is not available on SolvaPayClient')
    return client.activatePlan(coerceArgs(args))
  })
  registerClient('getPaymentMethod', args => {
    if (!client.getPaymentMethod) {
      throw new Error('getPaymentMethod is not available on SolvaPayClient')
    }
    return client.getPaymentMethod(coerceArgs(args))
  })
  registerClient('getAutoRecharge', args => {
    if (!client.getAutoRecharge) {
      throw new Error('getAutoRecharge is not available on SolvaPayClient')
    }
    return client.getAutoRecharge(coerceArgs(args))
  })
  registerClient('saveAutoRecharge', args => {
    if (!client.saveAutoRecharge) {
      throw new Error('saveAutoRecharge is not available on SolvaPayClient')
    }
    return client.saveAutoRecharge(coerceArgs(args))
  })
  registerClient('disableAutoRecharge', args => {
    if (!client.disableAutoRecharge) {
      throw new Error('disableAutoRecharge is not available on SolvaPayClient')
    }
    return client.disableAutoRecharge(coerceArgs(args))
  })

  registry.register('withRetry', {
    id: 'server',
    invoke: async args => {
      if (!isWithRetryScenario(args)) {
        throw new Error(
          'withRetry args must include attempts[]; optional options, shouldRetry, onRetry',
        )
      }

      const events: string[] = []
      const { fn, options } = buildScenario(args, events)
      const recorder = installDelayRecorder(ms => {
        events.push(formatSleepEvent(ms))
      })

      try {
        try {
          const value = await withRetry(fn, options)
          return {
            delays: recorder.delays,
            events,
            outcome: { type: 'resolved', value },
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          return {
            delays: recorder.delays,
            events,
            outcome: { type: 'rejected', name: err.name, message: err.message },
          }
        }
      } finally {
        recorder.restore()
      }
    },
  })

  registry.register('pollBalanceUntilIncreased', {
    id: 'server',
    invoke: async args => {
      if (!isBalancePollScenario(args)) {
        throw new Error(
          'pollBalanceUntilIncreased args must include baseline number, observations[], optional delays',
        )
      }

      let index = 0
      const getBalance = async () => {
        const observation = args.observations[index]
        index += 1
        if (observation === undefined) {
          throw new Error('pollBalanceUntilIncreased scenario exhausted observations')
        }
        if ('throw' in observation) {
          throw new Error(observation.throw)
        }
        return { credits: observation.credits }
      }

      const delayTable = resolveBalancePollDelays(args.delays)
      const recorder = installDelayRecorder(() => {})

      try {
        const result =
          delayTable === undefined
            ? await pollBalanceUntilIncreased(getBalance, args.baseline)
            : await pollBalanceUntilIncreased(getBalance, args.baseline, delayTable)
        return {
          delays: recorder.delays,
          result: result ?? null,
        }
      } finally {
        recorder.restore()
      }
    },
  })

  registry.register('TOPUP_BALANCE_POLL_DELAYS_MS', {
    id: 'server',
    invoke: () => [...TOPUP_BALANCE_POLL_DELAYS_MS],
  })

  registry.register('BALANCE_RECONCILE_DELAYS_MS', {
    id: 'server',
    invoke: () => [...BALANCE_RECONCILE_DELAYS_MS],
  })

  registry.register('classifyPaywallState', {
    id: 'server',
    invoke: args => {
      if (!isClassifyPaywallStateArgs(args)) {
        throw new Error('classifyPaywallState args must include limits (object or null)')
      }
      return classifyPaywallState(args.limits)
    },
  })

  registry.register('buildPaywallGate', {
    id: 'server',
    invoke: args => {
      if (!isBuildPaywallGateArgs(args)) {
        throw new Error('buildPaywallGate args must include productRef string and limits object')
      }
      return buildPaywallGate(args.productRef, args.limits)
    },
  })

  registry.register('buildGateMessage', {
    id: 'server',
    invoke: args => {
      if (!isBuildGateMessageArgs(args)) {
        throw new Error('buildGateMessage args must include state and gate with kind discriminants')
      }
      return buildGateMessage(args.state, args.gate)
    },
  })

  registry.register('buildNudgeMessage', {
    id: 'server',
    invoke: args => {
      if (!isBuildNudgeMessageArgs(args)) {
        throw new Error('buildNudgeMessage args must include state and limits (object or null)')
      }
      return buildNudgeMessage(args.state, args.limits)
    },
  })

  registry.register('paywallErrorToClientPayload', {
    id: 'server',
    invoke: args => {
      if (!isPaywallErrorToClientPayloadArgs(args)) {
        throw new Error(
          'paywallErrorToClientPayload args must include message string and structuredContent',
        )
      }
      return paywallErrorToClientPayload(new PaywallError(args.message, args.structuredContent))
    },
  })

  registry.register('validateBusinessDetails', {
    id: 'core',
    invoke: args => {
      if (!isBusinessDetailsInput(args)) {
        throw new Error('validateBusinessDetails args must include boolean isBusiness')
      }
      return validateBusinessDetails(args)
    },
  })

  registry.register('deriveTaxIdType', {
    id: 'core',
    invoke: args => {
      if (!isCountryArg(args)) {
        throw new Error('deriveTaxIdType args must include string country')
      }
      return deriveTaxIdType(args.country)
    },
  })

  registry.register('resolveTaxBehavior', {
    id: 'core',
    invoke: args => {
      if (!isResolveTaxBehaviorArgs(args)) {
        throw new Error('resolveTaxBehavior args must include string behavior and currency')
      }
      return resolveTaxBehavior(args.behavior, args.currency)
    },
  })

  registry.register('getTaxIdExample', {
    id: 'core',
    invoke: args => {
      if (!isCountryArg(args)) {
        throw new Error('getTaxIdExample args must include string country')
      }
      return getTaxIdExample(args.country)
    },
  })

  registry.register('getTaxIdFieldLabel', {
    id: 'core',
    invoke: args => {
      if (!isCountryArg(args)) {
        throw new Error('getTaxIdFieldLabel args must include string country')
      }
      return getTaxIdFieldLabel(args.country)
    },
  })

  registry.register('getTaxIdHelperText', {
    id: 'core',
    invoke: args => {
      if (!isCountryArg(args)) {
        throw new Error('getTaxIdHelperText args must include string country')
      }
      return getTaxIdHelperText(args.country)
    },
  })

  registry.register('getBusinessCountryOptions', {
    id: 'core',
    invoke: () => BUSINESS_COUNTRY_OPTIONS,
  })

  registry.register('minorUnitsPerMajor', {
    id: 'core',
    invoke: args => {
      if (!isCurrencyArg(args)) {
        throw new Error('minorUnitsPerMajor args must include string currency')
      }
      return minorUnitsPerMajor(args.currency)
    },
  })

  registry.register('isZeroDecimalCurrency', {
    id: 'core',
    invoke: args => {
      if (!isCurrencyArg(args)) {
        throw new Error('isZeroDecimalCurrency args must include string currency')
      }
      return isZeroDecimalCurrency(args.currency)
    },
  })

  registry.register('creditsToDisplayMinorUnits', {
    id: 'core',
    invoke: args => {
      if (!isCreditsToDisplayArgs(args)) {
        throw new Error(
          'creditsToDisplayMinorUnits args must include credits, creditsPerMinorUnit, displayExchangeRate (numbers) and displayCurrency (string)',
        )
      }
      return creditsToDisplayMinorUnits(args)
    },
  })

  registry.register('SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE', {
    id: 'core',
    invoke: () => SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  })

  registry.register('getSellerTaxIdentifierDisplayLabel', {
    id: 'core',
    invoke: args => {
      if (!isOptionalCountryArg(args)) {
        throw new Error(
          'getSellerTaxIdentifierDisplayLabel args.country must be string, null, or omitted',
        )
      }
      return getSellerTaxIdentifierDisplayLabel(args.country)
    },
  })

  registry.register('resolveSellerIdentityDisplay', {
    id: 'core',
    invoke: args => {
      if (!isResolveSellerIdentityArgs(args)) {
        throw new Error(
          'resolveSellerIdentityDisplay args country/vatNumber/taxId/companyNumber must be string, null, or omitted',
        )
      }
      return resolveSellerIdentityDisplay(args)
    },
  })

  registry.register('resolveAuthenticatedUser', {
    id: 'core',
    invoke: args => invokeResolveAuthenticatedUser(args),
  })

  registry.register('classifyCustomerRef', {
    id: 'core',
    invoke: args => {
      if (typeof args.customerRef !== 'string') {
        throw new Error('classifyCustomerRef args.customerRef must be a string')
      }
      return classifyCustomerRef(args.customerRef)
    },
  })

  registry.register('coerceCustomerOptions', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.email) || !isNullableString(args.name)) {
        throw new Error('coerceCustomerOptions args.email/name must be string, null, or omitted')
      }
      return coerceCustomerOptions(args.email, args.name)
    },
  })

  registry.register('buildCreateCustomerParams', {
    id: 'core',
    invoke: args => {
      if (typeof args.customerRef !== 'string') {
        throw new Error('buildCreateCustomerParams args.customerRef must be a string')
      }
      if (
        !isOptionalString(args.externalRef) ||
        !isOptionalString(args.email) ||
        !isOptionalString(args.name)
      ) {
        throw new Error(
          'buildCreateCustomerParams args.externalRef/email/name must be string or omitted',
        )
      }
      return buildCreateCustomerParams(
        args.customerRef,
        args.externalRef,
        args.email,
        args.name,
        Date.now(),
      )
    },
  })

  registry.register('extractBackendCustomerRef', {
    id: 'core',
    invoke: args => {
      if (args.response === null || typeof args.response !== 'object' || Array.isArray(args.response)) {
        throw new Error('extractBackendCustomerRef args.response must be an object')
      }
      if (typeof args.fallback !== 'string') {
        throw new Error('extractBackendCustomerRef args.fallback must be a string')
      }
      return extractBackendCustomerRef(args.response as Record<string, unknown>, args.fallback)
    },
  })

  registry.register('classifyLookupError', {
    id: 'core',
    invoke: args => {
      if (typeof args.message !== 'string') {
        throw new Error('classifyLookupError args.message must be a string')
      }
      return classifyLookupError(args.message)
    },
  })

  registry.register('classifyCreateError', {
    id: 'core',
    invoke: args => {
      if (typeof args.message !== 'string') {
        throw new Error('classifyCreateError args.message must be a string')
      }
      return classifyCreateError(args.message)
    },
  })

  registry.register('isEmailConflict', {
    id: 'core',
    invoke: args => {
      if (typeof args.message !== 'string') {
        throw new Error('isEmailConflict args.message must be a string')
      }
      return isEmailConflict(args.message)
    },
  })

  registry.register('validateActivatePlanParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.productRef) || !isNullableString(args.planRef)) {
        throw new Error(
          'validateActivatePlanParams args.productRef/planRef must be string, null, or omitted',
        )
      }
      return validateActivatePlanParams(args.productRef, args.planRef)
    },
  })

  registry.register('validateCreatePaymentIntentParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.planRef) || !isNullableString(args.productRef)) {
        throw new Error(
          'validateCreatePaymentIntentParams args.planRef/productRef must be string, null, or omitted',
        )
      }
      return validateCreatePaymentIntentParams(args.planRef, args.productRef)
    },
  })

  registry.register('validateTopupPaymentIntentParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableNumber(args.amount)) {
        throw new Error(
          'validateTopupPaymentIntentParams args.amount must be a number, null, or omitted',
        )
      }
      if (!isNullableString(args.currency)) {
        throw new Error(
          'validateTopupPaymentIntentParams args.currency must be string, null, or omitted',
        )
      }
      return validateTopupPaymentIntentParams(args.amount, args.currency)
    },
  })

  registry.register('validateProcessPaymentIntentParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.paymentIntentId) || !isNullableString(args.productRef)) {
        throw new Error(
          'validateProcessPaymentIntentParams args.paymentIntentId/productRef must be string, null, or omitted',
        )
      }
      return validateProcessPaymentIntentParams(args.paymentIntentId, args.productRef)
    },
  })

  registry.register('validateAttachBusinessDetailsParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.paymentIntentId)) {
        throw new Error(
          'validateAttachBusinessDetailsParams args.paymentIntentId must be string, null, or omitted',
        )
      }
      return validateAttachBusinessDetailsParams(args.paymentIntentId)
    },
  })

  registry.register('attachBusinessDetailsValidationError', {
    id: 'core',
    invoke: args => {
      if (!isOptionalString(args.firstIssueMessage)) {
        throw new Error(
          'attachBusinessDetailsValidationError args.firstIssueMessage must be string or omitted',
        )
      }
      return attachBusinessDetailsValidationError(args.firstIssueMessage)
    },
  })

  registry.register('projectPaymentIntentResult', {
    id: 'core',
    invoke: args => {
      if (
        typeof args.processorPaymentId !== 'string' ||
        typeof args.clientSecret !== 'string' ||
        typeof args.publishableKey !== 'string' ||
        typeof args.customerRef !== 'string'
      ) {
        throw new Error(
          'projectPaymentIntentResult requires string processorPaymentId/clientSecret/publishableKey/customerRef',
        )
      }
      if (!isOptionalString(args.accountId)) {
        throw new Error('projectPaymentIntentResult args.accountId must be string or omitted')
      }
      return projectPaymentIntentResult(
        {
          processorPaymentId: args.processorPaymentId,
          clientSecret: args.clientSecret,
          publishableKey: args.publishableKey,
          accountId: args.accountId,
        },
        args.customerRef,
      )
    },
  })

  registry.register('projectTopupProcessOutcome', {
    id: 'core',
    invoke: args => {
      if (!isOptionalString(args.status) && args.status !== null) {
        throw new Error(
          'projectTopupProcessOutcome args.status must be string, null, or omitted',
        )
      }
      if (!isOptionalString(args.message) && args.message !== null) {
        throw new Error(
          'projectTopupProcessOutcome args.message must be string, null, or omitted',
        )
      }
      const status =
        args.status === null || args.status === undefined ? undefined : args.status
      const message =
        args.message === null || args.message === undefined ? undefined : args.message
      return projectTopupProcessOutcome(status, message)
    },
  })

  registry.register('validateCheckoutSessionParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.productRef)) {
        throw new Error(
          'validateCheckoutSessionParams args.productRef must be string, null, or omitted',
        )
      }
      return validateCheckoutSessionParams(args.productRef)
    },
  })

  registry.register('resolveReturnUrl', {
    id: 'core',
    invoke: args => {
      if (
        !isNullableString(args.bodyReturnUrl) ||
        !isNullableString(args.optionsReturnUrl) ||
        !isNullableString(args.origin)
      ) {
        throw new Error(
          'resolveReturnUrl args.bodyReturnUrl/optionsReturnUrl/origin must be string, null, or omitted',
        )
      }
      // JSON fixtures cannot represent `undefined`; coerce for expect.result null parity.
      return resolveReturnUrl(args.bodyReturnUrl, args.optionsReturnUrl, args.origin) ?? null
    },
  })

  registry.register('selectActivePurchases', {
    id: 'core',
    invoke: args => {
      if (!Array.isArray(args.purchases)) {
        throw new Error('selectActivePurchases args.purchases must be an array')
      }
      return selectActivePurchases(args.purchases as Array<{ status?: string }>)
    },
  })

  registry.register('isCachedCustomerRefValid', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.externalRef) || !isNullableString(args.customerRef)) {
        throw new Error(
          'isCachedCustomerRefValid args.externalRef/customerRef must be string, null, or omitted',
        )
      }
      if (typeof args.userId !== 'string') {
        throw new Error('isCachedCustomerRefValid args.userId must be a string')
      }
      return isCachedCustomerRefValid(args.externalRef, args.userId, args.customerRef)
    },
  })

  registry.register('resolvePurchaseCustomerRef', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.customerRef)) {
        throw new Error(
          'resolvePurchaseCustomerRef args.customerRef must be string, null, or omitted',
        )
      }
      if (typeof args.userId !== 'string') {
        throw new Error('resolvePurchaseCustomerRef args.userId must be a string')
      }
      return resolvePurchaseCustomerRef(args.customerRef, args.userId)
    },
  })

  registry.register('validatePurchaseRef', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.purchaseRef)) {
        throw new Error(
          'validatePurchaseRef args.purchaseRef must be string, null, or omitted',
        )
      }
      return validatePurchaseRef(args.purchaseRef)
    },
  })

  registry.register('normalizeCancelResponse', {
    id: 'core',
    invoke: args => normalizeCancelResponse(args.response),
  })

  registry.register('normalizeReactivateResponse', {
    id: 'core',
    invoke: args => normalizeReactivateResponse(args.response),
  })

  registry.register('classifyCancelError', {
    id: 'core',
    invoke: args => {
      if (typeof args.message !== 'string') {
        throw new Error('classifyCancelError args.message must be a string')
      }
      return classifyCancelError(args.message)
    },
  })

  registry.register('classifyReactivateError', {
    id: 'core',
    invoke: args => {
      if (typeof args.message !== 'string') {
        throw new Error('classifyReactivateError args.message must be a string')
      }
      return classifyReactivateError(args.message)
    },
  })

  registry.register('projectUsageSnapshot', {
    id: 'core',
    invoke: args => {
      const purchase = args.activePurchase
      if (
        purchase !== null &&
        purchase !== undefined &&
        (typeof purchase !== 'object' || Array.isArray(purchase))
      ) {
        throw new Error(
          'projectUsageSnapshot args.activePurchase must be an object, null, or omitted',
        )
      }
      return projectUsageSnapshot(purchase as UsageSnapshotPurchase | null | undefined)
    },
  })

  registry.register('resolveCheckLimitsParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.productRef) || !isNullableString(args.meterName)) {
        throw new Error(
          'resolveCheckLimitsParams args.productRef/meterName must be string, null, or omitted',
        )
      }
      return resolveCheckLimitsParams(args.productRef, args.meterName)
    },
  })

  registry.register('validateListPlansParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.productRef)) {
        throw new Error(
          'validateListPlansParams args.productRef must be string, null, or omitted',
        )
      }
      return validateListPlansParams(args.productRef)
    },
  })

  registry.register('mapRouteError', {
    id: 'core',
    invoke: args => {
      if (
        args.kind !== 'solvapay' &&
        args.kind !== 'error' &&
        args.kind !== 'unknown'
      ) {
        throw new Error(
          "mapRouteError args.kind must be 'solvapay' | 'error' | 'unknown'",
        )
      }
      if (!isNullableString(args.message) || !isNullableString(args.defaultMessage)) {
        throw new Error(
          'mapRouteError args.message/defaultMessage must be string, null, or omitted',
        )
      }
      if (typeof args.operationName !== 'string') {
        throw new Error('mapRouteError args.operationName must be a string')
      }
      let status: number | null | undefined
      if (args.status === undefined || args.status === null) {
        status = args.status
      } else if (typeof args.status === 'number') {
        status = args.status
      } else {
        throw new Error('mapRouteError args.status must be a number, null, or omitted')
      }
      return mapRouteError({
        kind: args.kind,
        message: args.message ?? null,
        status,
        operationName: args.operationName,
        defaultMessage: args.defaultMessage,
      })
    },
  })

  registry.register('isErrorResult', {
    id: 'core',
    invoke: args => isErrorResult(args.result),
  })

  registry.register('validateGetProductParams', {
    id: 'core',
    invoke: args => {
      if (!isNullableString(args.productRef)) {
        throw new Error(
          'validateGetProductParams args.productRef must be string, null, or omitted',
        )
      }
      return validateGetProductParams(args.productRef)
    },
  })

  return registry
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === 'number'
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

async function invokeResolveAuthenticatedUser(
  args: Record<string, unknown>,
): Promise<unknown> {
  const headerUserId =
    args.headerUserId === undefined || args.headerUserId === null
      ? undefined
      : typeof args.headerUserId === 'string'
        ? args.headerUserId
        : undefined
  if (args.headerUserId !== undefined && args.headerUserId !== null && typeof args.headerUserId !== 'string') {
    throw new Error('resolveAuthenticatedUser args.headerUserId must be string, null, or omitted')
  }
  if (
    args.authorizationHeader !== undefined &&
    args.authorizationHeader !== null &&
    typeof args.authorizationHeader !== 'string'
  ) {
    throw new Error(
      'resolveAuthenticatedUser args.authorizationHeader must be string, null, or omitted',
    )
  }
  if (args.jwtSecret !== undefined && args.jwtSecret !== null && typeof args.jwtSecret !== 'string') {
    throw new Error('resolveAuthenticatedUser args.jwtSecret must be string, null, or omitted')
  }
  if (typeof args.strictMode !== 'boolean') {
    throw new Error('resolveAuthenticatedUser args.strictMode must be a boolean')
  }
  if (typeof args.includeEmail !== 'boolean' || typeof args.includeName !== 'boolean') {
    throw new Error('resolveAuthenticatedUser args.includeEmail/includeName must be booleans')
  }

  const authorizationHeader =
    typeof args.authorizationHeader === 'string' ? args.authorizationHeader : undefined
  const jwtSecret = typeof args.jwtSecret === 'string' ? args.jwtSecret : undefined

  const headers = new Headers()
  // Empty string is falsy in getAuthenticatedUserCore (`if (headerUserId)`).
  if (headerUserId !== undefined && headerUserId.length > 0) {
    headers.set('x-user-id', headerUserId)
  }
  if (authorizationHeader !== undefined) {
    headers.set('authorization', authorizationHeader)
  }

  const envKeys = ['SOLVAPAY_AUTH_STRICT', 'SOLVAPAY_JWT_SECRET', 'SUPABASE_JWT_SECRET'] as const
  const previous = new Map<string, string | undefined>()
  for (const key of envKeys) {
    previous.set(key, process.env[key])
    delete process.env[key]
  }

  try {
    if (args.strictMode) {
      process.env.SOLVAPAY_AUTH_STRICT = 'true'
    }
    if (jwtSecret !== undefined) {
      process.env.SOLVAPAY_JWT_SECRET = jwtSecret
    }
    return await getAuthenticatedUserCore(new Request('https://fixture.local/auth', { headers }), {
      includeEmail: args.includeEmail,
      includeName: args.includeName,
    })
  } finally {
    for (const key of envKeys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

export async function replayFixture(fixture: Fixture, options: ReplayOptions): Promise<void> {
  const bindings = options.registry.get(fixture.input.fn)
  for (const binding of bindings) {
    await replayAgainstBinding(fixture, binding)
  }
}

async function replayAgainstBinding(fixture: Fixture, binding: FixtureBinding): Promise<void> {
  const globals = snapshotGlobals()
  const captured: CapturedRequest[] = []

  try {
    if (fixture.input.clock !== undefined) {
      patchClock(fixture.input.clock)
    }
    if (fixture.input.rngSeed !== undefined) {
      patchRng(fixture.input.rngSeed)
    }
    if (fixture.wire) {
      installMockFetch(fixture.wire, request => {
        captured.push(request)
      })
    }

    let result: unknown
    let threw: unknown
    try {
      result = await binding.invoke(fixture.input.args)
    } catch (error) {
      threw = error
    }

    if (fixture.wire) {
      assert.equal(captured.length, 1, 'wire fixture expected exactly one fetch call')
      const request = captured[0]
      assert.ok(request, 'wire fixture captured no request')
      assertWireRequest(request, fixture.wire.request)
    }

    if (fixture.expect.error !== undefined) {
      if (threw === undefined) {
        throw new Error(
          `Fixture ${fixture.suite}/${fixture.case} (${binding.id}) expected an error but binding succeeded`,
        )
      }
      assertExpectedError(threw, fixture.expect.error)
      return
    }

    if (threw !== undefined) {
      throw threw
    }

    assert.deepEqual(
      result,
      fixture.expect.result,
      `Fixture ${fixture.suite}/${fixture.case} (${binding.id}) result mismatch`,
    )
  } finally {
    restoreGlobals(globals)
  }
}
