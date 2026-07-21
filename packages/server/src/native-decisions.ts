/**
 * Sync decision-core delegation layer (Step 37R-c).
 *
 * Pure logic surfaces (`@solvapay/core` extracts + paywall/retry) dispatch to
 * napi via an *installed* API so this module never statically imports
 * `./native` or `node:module` — keeping the edge/Deno graph safe.
 *
 * Node entry (`index.ts`) and vitest setup call `installNativeDecisionApi`.
 * Edge never installs → always TypeScript fallback.
 */

import {
  attachBusinessDetailsValidationError as attachBusinessDetailsValidationErrorTs,
  buildCreateCustomerParams as buildCreateCustomerParamsTs,
  classifyCancelError as classifyCancelErrorTs,
  classifyCreateError as classifyCreateErrorTs,
  classifyCustomerRef as classifyCustomerRefTs,
  classifyLookupError as classifyLookupErrorTs,
  classifyReactivateError as classifyReactivateErrorTs,
  coerceCustomerOptions as coerceCustomerOptionsTs,
  decidePaywallOutcome as decidePaywallOutcomeTs,
  evaluateCachedLimits as evaluateCachedLimitsTs,
  evaluateFreshLimits as evaluateFreshLimitsTs,
  extractBackendCustomerRef as extractBackendCustomerRefTs,
  isCachedCustomerRefValid as isCachedCustomerRefValidTs,
  isEmailConflict as isEmailConflictTs,
  isErrorResult as isErrorResultTs,
  mapRouteError as mapRouteErrorTs,
  normalizeCancelResponse as normalizeCancelResponseTs,
  normalizeReactivateResponse as normalizeReactivateResponseTs,
  projectPaymentIntentResult as projectPaymentIntentResultTs,
  projectTopupProcessOutcome as projectTopupProcessOutcomeTs,
  projectUsageSnapshot as projectUsageSnapshotTs,
  resolveCheckLimitsParams as resolveCheckLimitsParamsTs,
  resolveFallbackGateLimits as resolveFallbackGateLimitsTs,
  resolveProductRef as resolveProductRefTs,
  resolvePurchaseCustomerRef as resolvePurchaseCustomerRefTs,
  resolveReturnUrl as resolveReturnUrlTs,
  selectActivePurchases as selectActivePurchasesTs,
  validateActivatePlanParams as validateActivatePlanParamsTs,
  validateAttachBusinessDetailsParams as validateAttachBusinessDetailsParamsTs,
  validateCheckoutSessionParams as validateCheckoutSessionParamsTs,
  validateCreatePaymentIntentParams as validateCreatePaymentIntentParamsTs,
  validateGetProductParams as validateGetProductParamsTs,
  validateListPlansParams as validateListPlansParamsTs,
  validateProcessPaymentIntentParams as validateProcessPaymentIntentParamsTs,
  validatePurchaseRef as validatePurchaseRefTs,
  validateTopupPaymentIntentParams as validateTopupPaymentIntentParamsTs,
  type ActivatePlanValidationError,
  type CachedLimitsEvaluation,
  type CheckoutHelperError,
  type CoercedCustomerOptions,
  type CreateCustomerParams,
  type CreateErrorKind,
  type CustomerRefKind,
  type CheckLimitsParams,
  type FreshLimitsEvaluation,
  type LimitsHelperError,
  type LookupErrorKind,
  type PaymentHelperError,
  type PaymentIntentProjection,
  type PaymentIntentSource,
  type PaywallDecisionLimits,
  type PaywallOutcome,
  type PlansHelperError,
  type ProductHelperError,
  type RenewalHelperError,
  type RouteErrorInput,
  type RouteErrorResult,
  type TopupProcessOutcome,
  type UsageSnapshot,
  type UsageSnapshotPurchase,
} from '@solvapay/core'
import type { NativeSyncMethod, SolvaPayImpl } from './native'
import {
  buildGateMessage as buildGateMessageTs,
  buildNudgeMessage as buildNudgeMessageTs,
  classifyPaywallState as classifyPaywallStateTs,
  type PaywallState,
} from './paywall-state-ts'
import { buildPaywallGate as buildPaywallGateTs } from './paywall-gate-ts'
import {
  paywallErrorToClientPayloadTs,
  type PaywallErrorLike,
} from './paywall-payload-ts'
import type {
  LimitResponseWithPlan,
  PaywallStructuredContent,
} from './types'

export type { PaywallState }

type NativeDecisionApi = {
  callNativeSync: (fn: NativeSyncMethod, argsJson: string) => unknown
  resolveImpl: (surface: string) => SolvaPayImpl
}

let installed: NativeDecisionApi | null = null

export function installNativeDecisionApi(api: NativeDecisionApi): void {
  installed = api
}

/** @internal test helper */
export function resetNativeDecisionApiForTests(): void {
  installed = null
}

function dispatchSync<T>(fn: NativeSyncMethod, args: unknown, tsFallback: () => T): T {
  // The install is the gate: Node installs napi dispatch (`index.ts`), edge
  // installs WASM dispatch (`edge.ts`). Uninstalled (browser / no warm-up) →
  // TS. `resolveImpl` carries the `SOLVAPAY_IMPL` rollback per runtime.
  if (installed === null || installed.resolveImpl('helper') !== 'rust') {
    return tsFallback()
  }
  return installed.callNativeSync(fn, JSON.stringify(args)) as T
}

// --- customer-sync ---

export function classifyCustomerRef(customerRef: string): CustomerRefKind {
  return dispatchSync(
    'classifyCustomerRef',
    { customerRef },
    () => classifyCustomerRefTs(customerRef),
  )
}

export function coerceCustomerOptions(
  email: string | null | undefined,
  name: string | null | undefined,
): CoercedCustomerOptions {
  return dispatchSync(
    'coerceCustomerOptions',
    { email: email ?? null, name: name ?? null },
    () => coerceCustomerOptionsTs(email, name),
  )
}

export function buildCreateCustomerParams(
  customerRef: string,
  externalRef: string | undefined,
  email: string | undefined,
  name: string | undefined,
  nowMs: number,
): CreateCustomerParams {
  return dispatchSync(
    'buildCreateCustomerParams',
    {
      customerRef,
      externalRef: externalRef ?? null,
      email: email ?? null,
      name: name ?? null,
      nowMs,
    },
    () => buildCreateCustomerParamsTs(customerRef, externalRef, email, name, nowMs),
  )
}

export function extractBackendCustomerRef(
  response: Record<string, unknown>,
  fallback: string,
): string {
  return dispatchSync(
    'extractBackendCustomerRef',
    { response, fallback },
    () => extractBackendCustomerRefTs(response, fallback),
  )
}

export function classifyLookupError(message: string): LookupErrorKind {
  return dispatchSync('classifyLookupError', { message }, () => classifyLookupErrorTs(message))
}

export function classifyCreateError(message: string): CreateErrorKind {
  return dispatchSync('classifyCreateError', { message }, () => classifyCreateErrorTs(message))
}

export function isEmailConflict(message: string): boolean {
  return dispatchSync('isEmailConflict', { message }, () => isEmailConflictTs(message))
}

// --- activation ---

export function validateActivatePlanParams(
  productRef: string | null | undefined,
  planRef: string | null | undefined,
): ActivatePlanValidationError | null {
  return dispatchSync(
    'validateActivatePlanParams',
    { productRef: productRef ?? null, planRef: planRef ?? null },
    () => validateActivatePlanParamsTs(productRef, planRef),
  )
}

// --- payment ---

export function validateCreatePaymentIntentParams(
  planRef: string | null | undefined,
  productRef: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync(
    'validateCreatePaymentIntentParams',
    { planRef: planRef ?? null, productRef: productRef ?? null },
    () => validateCreatePaymentIntentParamsTs(planRef, productRef),
  )
}

export function validateTopupPaymentIntentParams(
  amount: number | null | undefined,
  currency: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync(
    'validateTopupPaymentIntentParams',
    { amount: amount ?? null, currency: currency ?? null },
    () => validateTopupPaymentIntentParamsTs(amount, currency),
  )
}

export function validateProcessPaymentIntentParams(
  paymentIntentId: string | null | undefined,
  productRef: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync(
    'validateProcessPaymentIntentParams',
    { paymentIntentId: paymentIntentId ?? null, productRef: productRef ?? null },
    () => validateProcessPaymentIntentParamsTs(paymentIntentId, productRef),
  )
}

export function validateAttachBusinessDetailsParams(
  paymentIntentId: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync(
    'validateAttachBusinessDetailsParams',
    { paymentIntentId: paymentIntentId ?? null },
    () => validateAttachBusinessDetailsParamsTs(paymentIntentId),
  )
}

export function attachBusinessDetailsValidationError(
  firstIssueMessage?: string,
): PaymentHelperError {
  return dispatchSync(
    'attachBusinessDetailsValidationError',
    { firstIssueMessage: firstIssueMessage ?? null },
    () => attachBusinessDetailsValidationErrorTs(firstIssueMessage),
  )
}

export function projectPaymentIntentResult(
  pi: PaymentIntentSource,
  customerRef: string,
): PaymentIntentProjection {
  return dispatchSync(
    'projectPaymentIntentResult',
    {
      processorPaymentId: pi.processorPaymentId,
      clientSecret: pi.clientSecret,
      publishableKey: pi.publishableKey,
      ...(pi.accountId !== undefined ? { accountId: pi.accountId } : {}),
      customerRef,
    },
    () => projectPaymentIntentResultTs(pi, customerRef),
  )
}

export function projectTopupProcessOutcome(
  status?: string,
  message?: string,
): TopupProcessOutcome {
  return dispatchSync(
    'projectTopupProcessOutcome',
    { status: status ?? null, message: message ?? null },
    () => projectTopupProcessOutcomeTs(status, message),
  )
}

// --- checkout ---

export function resolveReturnUrl(
  bodyReturnUrl?: string | null,
  optionsReturnUrl?: string | null,
  origin?: string | null,
): string | undefined {
  const result = dispatchSync(
    'resolveReturnUrl',
    {
      bodyReturnUrl: bodyReturnUrl ?? null,
      optionsReturnUrl: optionsReturnUrl ?? null,
      origin: origin ?? null,
    },
    () => resolveReturnUrlTs(bodyReturnUrl, optionsReturnUrl, origin),
  )
  return result === null ? undefined : result
}

export function validateCheckoutSessionParams(
  productRef: string | null | undefined,
): CheckoutHelperError | null {
  return dispatchSync(
    'validateCheckoutSessionParams',
    { productRef: productRef ?? null },
    () => validateCheckoutSessionParamsTs(productRef),
  )
}

// --- purchase ---

export function isCachedCustomerRefValid(
  externalRef: string | null | undefined,
  userId: string,
  customerRef: string | null | undefined,
): boolean {
  return dispatchSync(
    'isCachedCustomerRefValid',
    {
      externalRef: externalRef ?? null,
      userId,
      customerRef: customerRef ?? null,
    },
    () => isCachedCustomerRefValidTs(externalRef, userId, customerRef),
  )
}

export function resolvePurchaseCustomerRef(
  customerRef: string | null | undefined,
  userId: string,
): string {
  return dispatchSync(
    'resolvePurchaseCustomerRef',
    { customerRef: customerRef ?? null, userId },
    () => resolvePurchaseCustomerRefTs(customerRef, userId),
  )
}

export function selectActivePurchases<T extends { status?: string }>(purchases: T[]): T[] {
  return dispatchSync(
    'selectActivePurchases',
    { purchases },
    () => selectActivePurchasesTs(purchases),
  )
}

// --- renewal ---

export function classifyCancelError(message: string): RenewalHelperError {
  return dispatchSync('classifyCancelError', { message }, () => classifyCancelErrorTs(message))
}

export function classifyReactivateError(message: string): RenewalHelperError {
  return dispatchSync(
    'classifyReactivateError',
    { message },
    () => classifyReactivateErrorTs(message),
  )
}

export function normalizeCancelResponse(
  response: unknown,
): Record<string, unknown> | RenewalHelperError {
  return dispatchSync(
    'normalizeCancelResponse',
    { response },
    () => normalizeCancelResponseTs(response),
  )
}

export function normalizeReactivateResponse(
  response: unknown,
): Record<string, unknown> | RenewalHelperError {
  return dispatchSync(
    'normalizeReactivateResponse',
    { response },
    () => normalizeReactivateResponseTs(response),
  )
}

export function validatePurchaseRef(
  purchaseRef: string | null | undefined,
): RenewalHelperError | null {
  return dispatchSync(
    'validatePurchaseRef',
    { purchaseRef: purchaseRef ?? null },
    () => validatePurchaseRefTs(purchaseRef),
  )
}

// --- usage ---

export function projectUsageSnapshot(
  activePurchase: UsageSnapshotPurchase | null | undefined,
): UsageSnapshot {
  return dispatchSync(
    'projectUsageSnapshot',
    { activePurchase: activePurchase ?? null },
    () => projectUsageSnapshotTs(activePurchase),
  )
}

// --- limits ---

export function resolveCheckLimitsParams(
  productRef: string | null | undefined,
  meterName: string | null | undefined,
): CheckLimitsParams | LimitsHelperError {
  return dispatchSync(
    'resolveCheckLimitsParams',
    { productRef: productRef ?? null, meterName: meterName ?? null },
    () => resolveCheckLimitsParamsTs(productRef, meterName),
  )
}

// --- plans ---

export function validateListPlansParams(
  productRef: string | null | undefined,
): PlansHelperError | null {
  return dispatchSync(
    'validateListPlansParams',
    { productRef: productRef ?? null },
    () => validateListPlansParamsTs(productRef),
  )
}

// --- error ---

export function isErrorResult(result: unknown): result is RouteErrorResult {
  return dispatchSync('isErrorResult', { result }, () => isErrorResultTs(result))
}

export function mapRouteError(input: RouteErrorInput): RouteErrorResult {
  return dispatchSync(
    'mapRouteError',
    {
      kind: input.kind,
      message: input.message,
      defaultMessage: input.defaultMessage ?? null,
      operationName: input.operationName,
      status: input.status ?? null,
    },
    () => mapRouteErrorTs(input),
  )
}

// --- product ---

export function validateGetProductParams(
  productRef: string | null | undefined,
): ProductHelperError | null {
  return dispatchSync(
    'validateGetProductParams',
    { productRef: productRef ?? null },
    () => validateGetProductParamsTs(productRef),
  )
}

// --- paywall-decision ---

export function resolveProductRef(
  metadataProduct?: string | null,
  envProduct?: string | null,
): string {
  return dispatchSync(
    'resolveProductRef',
    {
      metadataProduct: metadataProduct ?? null,
      envProduct: envProduct ?? null,
    },
    () => resolveProductRefTs(metadataProduct, envProduct),
  )
}

export function evaluateCachedLimits(remaining: number): CachedLimitsEvaluation {
  return dispatchSync(
    'evaluateCachedLimits',
    { remaining },
    () => evaluateCachedLimitsTs(remaining),
  )
}

export function evaluateFreshLimits(
  withinLimits: boolean,
  remaining: number,
): FreshLimitsEvaluation {
  return dispatchSync(
    'evaluateFreshLimits',
    { withinLimits, remaining },
    () => evaluateFreshLimitsTs(withinLimits, remaining),
  )
}

export function decidePaywallOutcome<TGate>(input: {
  withinLimits: boolean
  product: string
  limits: PaywallDecisionLimits | null
  checkoutUrl?: string
  buildGate: (product: string, limits: PaywallDecisionLimits) => TGate
}): PaywallOutcome<TGate> {
  if (installed === null || installed.resolveImpl('helper') !== 'rust') {
    return decidePaywallOutcomeTs(input)
  }
  // Rust path ignores `buildGate` — uses in-crate `build_paywall_gate`.
  return installed.callNativeSync(
    'decidePaywallOutcome',
    JSON.stringify({
      withinLimits: input.withinLimits,
      product: input.product,
      limits: input.limits,
      checkoutUrl: input.checkoutUrl ?? null,
    }),
  ) as PaywallOutcome<TGate>
}

export function resolveFallbackGateLimits(checkoutUrl?: string): PaywallDecisionLimits {
  return dispatchSync(
    'resolveFallbackGateLimits',
    { checkoutUrl: checkoutUrl ?? null },
    () => resolveFallbackGateLimitsTs(checkoutUrl),
  )
}

// --- paywall state / gate / payload ---

export function classifyPaywallState(
  limits: LimitResponseWithPlan | null,
): PaywallState {
  return dispatchSync(
    'classifyPaywallState',
    { limits },
    () => classifyPaywallStateTs(limits),
  )
}

export function buildGateMessage(
  state: PaywallState,
  gate: PaywallStructuredContent,
): string {
  return dispatchSync(
    'buildGateMessage',
    { state, gate },
    () => buildGateMessageTs(state, gate),
  )
}

export function buildNudgeMessage(
  state: PaywallState,
  limits: LimitResponseWithPlan | null,
): string {
  return dispatchSync(
    'buildNudgeMessage',
    { state, limits },
    () => buildNudgeMessageTs(state, limits),
  )
}

type LimitsLike = Omit<LimitResponseWithPlan, 'plan'> & {
  plan?: LimitResponseWithPlan['plan']
}

export function buildPaywallGate(
  productRef: string,
  limits: LimitsLike,
): PaywallStructuredContent {
  return dispatchSync(
    'buildPaywallGate',
    { productRef, limits },
    () => buildPaywallGateTs(productRef, limits),
  )
}

export function paywallErrorToClientPayload(
  error: PaywallErrorLike,
): Record<string, unknown> {
  return dispatchSync(
    'paywallErrorToClientPayload',
    {
      message: error.message,
      structuredContent: error.structuredContent,
    },
    () => paywallErrorToClientPayloadTs(error),
  )
}

// --- retry ---

function calculateDelayTs(
  initialDelay: number,
  attempt: number,
  strategy: 'fixed' | 'linear' | 'exponential',
): number {
  switch (strategy) {
    case 'fixed':
      return initialDelay
    case 'linear':
      return initialDelay * (attempt + 1)
    case 'exponential':
      return initialDelay * Math.pow(2, attempt)
    default:
      return initialDelay
  }
}

/**
 * Next retry delay in ms, or `null` when retries are exhausted
 * (`attempt >= maxRetries`). Used by `withRetry`; host timers stay in utils.
 */
export function retryNextDelayMs(options: {
  maxRetries: number
  initialDelay: number
  backoffStrategy: 'fixed' | 'linear' | 'exponential'
  attempt: number
}): number | null {
  return dispatchSync('retryNextDelayMs', options, () => {
    if (options.attempt >= options.maxRetries) return null
    return calculateDelayTs(options.initialDelay, options.attempt, options.backoffStrategy)
  })
}
