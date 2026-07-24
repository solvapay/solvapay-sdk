/**
 * Sync decision-core dispatch layer (Step 37R-c → Step 53).
 *
 * Pure logic surfaces (`@solvapay/core` extracts + paywall/retry) dispatch to
 * napi (Node) or WASM (edge) via an *installed* API so this module never
 * statically imports `./native` or `node:module` — keeping the edge/Deno graph
 * safe.
 *
 * Node entry (`index.ts`) installs napi dispatch; edge entry (`edge.ts`)
 * installs WASM dispatch. After Step 53 the logic is Rust-only: an uninstalled
 * API — or `SOLVAPAY_IMPL=ts` — throws {@link SolvaPayError}. Restoring the old
 * behaviour requires republishing the prior `@solvapay/server` facade.
 */

import { SolvaPayError } from '@solvapay/core'
import type {
  ActivatePlanValidationError,
  CachedLimitsEvaluation,
  CheckoutHelperError,
  CoercedCustomerOptions,
  CreateCustomerParams,
  CreateErrorKind,
  CustomerRefKind,
  CheckLimitsParams,
  FreshLimitsEvaluation,
  LimitsHelperError,
  LookupErrorKind,
  PaymentHelperError,
  PaymentIntentProjection,
  PaymentIntentSource,
  PaywallDecisionLimits,
  PaywallOutcome,
  PlansHelperError,
  ProductHelperError,
  RenewalHelperError,
  RouteErrorInput,
  RouteErrorResult,
  TopupProcessOutcome,
  UsageSnapshot,
  UsageSnapshotPurchase,
} from '@solvapay/core'
import type { NativeSyncMethod, SolvaPayImpl } from './native'
import type {
  LimitResponseWithPlan,
  PaywallStructuredContent,
} from './types'
import type { PaywallState } from './types/paywall'

export type { PaywallState }

/** Duck-typed error shape — matches `PaywallError` without importing the class. */
export type PaywallErrorLike = {
  message: string
  structuredContent: PaywallStructuredContent
}

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

/**
 * Dispatches a sync decision/helper method to the installed binding.
 *
 * The install is the gate: Node installs napi dispatch (`index.ts`), edge
 * installs WASM dispatch (`edge.ts`). Throws when uninstalled or when
 * `SOLVAPAY_IMPL` forces TypeScript — Rust-only after Step 53, no fallback.
 */
function dispatchSync<T>(fn: NativeSyncMethod, args: unknown): T {
  if (installed === null || installed.resolveImpl('helper') !== 'rust') {
    throw new SolvaPayError('server sync API not installed')
  }
  return installed.callNativeSync(fn, JSON.stringify(args)) as T
}

// --- customer-sync ---

export function classifyCustomerRef(customerRef: string): CustomerRefKind {
  return dispatchSync('classifyCustomerRef', { customerRef })
}

export function coerceCustomerOptions(
  email: string | null | undefined,
  name: string | null | undefined,
): CoercedCustomerOptions {
  return dispatchSync('coerceCustomerOptions', { email: email ?? null, name: name ?? null })
}

export function buildCreateCustomerParams(
  customerRef: string,
  externalRef: string | undefined,
  email: string | undefined,
  name: string | undefined,
  nowMs: number,
): CreateCustomerParams {
  return dispatchSync('buildCreateCustomerParams', {
    customerRef,
    externalRef: externalRef ?? null,
    email: email ?? null,
    name: name ?? null,
    nowMs,
  })
}

export function extractBackendCustomerRef(
  response: Record<string, unknown>,
  fallback: string,
): string {
  return dispatchSync('extractBackendCustomerRef', { response, fallback })
}

export function classifyLookupError(message: string): LookupErrorKind {
  return dispatchSync('classifyLookupError', { message })
}

export function classifyCreateError(message: string): CreateErrorKind {
  return dispatchSync('classifyCreateError', { message })
}

export function isEmailConflict(message: string): boolean {
  return dispatchSync('isEmailConflict', { message })
}

// --- activation ---

export function validateActivatePlanParams(
  productRef: string | null | undefined,
  planRef: string | null | undefined,
): ActivatePlanValidationError | null {
  return dispatchSync('validateActivatePlanParams', {
    productRef: productRef ?? null,
    planRef: planRef ?? null,
  })
}

// --- payment ---

export function validateCreatePaymentIntentParams(
  planRef: string | null | undefined,
  productRef: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync('validateCreatePaymentIntentParams', {
    planRef: planRef ?? null,
    productRef: productRef ?? null,
  })
}

export function validateTopupPaymentIntentParams(
  amount: number | null | undefined,
  currency: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync('validateTopupPaymentIntentParams', {
    amount: amount ?? null,
    currency: currency ?? null,
  })
}

export function validateProcessPaymentIntentParams(
  paymentIntentId: string | null | undefined,
  productRef: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync('validateProcessPaymentIntentParams', {
    paymentIntentId: paymentIntentId ?? null,
    productRef: productRef ?? null,
  })
}

export function validateAttachBusinessDetailsParams(
  paymentIntentId: string | null | undefined,
): PaymentHelperError | null {
  return dispatchSync('validateAttachBusinessDetailsParams', {
    paymentIntentId: paymentIntentId ?? null,
  })
}

export function attachBusinessDetailsValidationError(
  firstIssueMessage?: string,
): PaymentHelperError {
  return dispatchSync('attachBusinessDetailsValidationError', {
    firstIssueMessage: firstIssueMessage ?? null,
  })
}

export function projectPaymentIntentResult(
  pi: PaymentIntentSource,
  customerRef: string,
): PaymentIntentProjection {
  return dispatchSync('projectPaymentIntentResult', {
    processorPaymentId: pi.processorPaymentId,
    clientSecret: pi.clientSecret,
    publishableKey: pi.publishableKey,
    ...(pi.accountId !== undefined ? { accountId: pi.accountId } : {}),
    customerRef,
  })
}

export function projectTopupProcessOutcome(
  status?: string,
  message?: string,
): TopupProcessOutcome {
  return dispatchSync('projectTopupProcessOutcome', {
    status: status ?? null,
    message: message ?? null,
  })
}

// --- checkout ---

export function resolveReturnUrl(
  bodyReturnUrl?: string | null,
  optionsReturnUrl?: string | null,
  origin?: string | null,
): string | undefined {
  const result = dispatchSync<string | null>('resolveReturnUrl', {
    bodyReturnUrl: bodyReturnUrl ?? null,
    optionsReturnUrl: optionsReturnUrl ?? null,
    origin: origin ?? null,
  })
  return result === null ? undefined : result
}

export function validateCheckoutSessionParams(
  productRef: string | null | undefined,
): CheckoutHelperError | null {
  return dispatchSync('validateCheckoutSessionParams', { productRef: productRef ?? null })
}

// --- purchase ---

export function isCachedCustomerRefValid(
  externalRef: string | null | undefined,
  userId: string,
  customerRef: string | null | undefined,
): boolean {
  return dispatchSync('isCachedCustomerRefValid', {
    externalRef: externalRef ?? null,
    userId,
    customerRef: customerRef ?? null,
  })
}

export function resolvePurchaseCustomerRef(
  customerRef: string | null | undefined,
  userId: string,
): string {
  return dispatchSync('resolvePurchaseCustomerRef', { customerRef: customerRef ?? null, userId })
}

export function selectActivePurchases<T extends { status?: string }>(purchases: T[]): T[] {
  return dispatchSync('selectActivePurchases', { purchases })
}

// --- renewal ---

export function classifyCancelError(message: string): RenewalHelperError {
  return dispatchSync('classifyCancelError', { message })
}

export function classifyReactivateError(message: string): RenewalHelperError {
  return dispatchSync('classifyReactivateError', { message })
}

export function normalizeCancelResponse(
  response: unknown,
): Record<string, unknown> | RenewalHelperError {
  return dispatchSync('normalizeCancelResponse', { response })
}

export function normalizeReactivateResponse(
  response: unknown,
): Record<string, unknown> | RenewalHelperError {
  return dispatchSync('normalizeReactivateResponse', { response })
}

export function validatePurchaseRef(
  purchaseRef: string | null | undefined,
): RenewalHelperError | null {
  return dispatchSync('validatePurchaseRef', { purchaseRef: purchaseRef ?? null })
}

// --- usage ---

export function projectUsageSnapshot(
  activePurchase: UsageSnapshotPurchase | null | undefined,
): UsageSnapshot {
  return dispatchSync('projectUsageSnapshot', { activePurchase: activePurchase ?? null })
}

// --- limits ---

export function resolveCheckLimitsParams(
  productRef: string | null | undefined,
  meterName: string | null | undefined,
): CheckLimitsParams | LimitsHelperError {
  return dispatchSync('resolveCheckLimitsParams', {
    productRef: productRef ?? null,
    meterName: meterName ?? null,
  })
}

// --- plans ---

export function validateListPlansParams(
  productRef: string | null | undefined,
): PlansHelperError | null {
  return dispatchSync('validateListPlansParams', { productRef: productRef ?? null })
}

// --- error ---

export function isErrorResult(result: unknown): result is RouteErrorResult {
  return dispatchSync('isErrorResult', { result })
}

export function mapRouteError(input: RouteErrorInput): RouteErrorResult {
  return dispatchSync('mapRouteError', {
    kind: input.kind,
    message: input.message,
    defaultMessage: input.defaultMessage ?? null,
    operationName: input.operationName,
    status: input.status ?? null,
  })
}

// --- product ---

export function validateGetProductParams(
  productRef: string | null | undefined,
): ProductHelperError | null {
  return dispatchSync('validateGetProductParams', { productRef: productRef ?? null })
}

// --- paywall-decision ---

export function resolveProductRef(
  metadataProduct?: string | null,
  envProduct?: string | null,
): string {
  return dispatchSync('resolveProductRef', {
    metadataProduct: metadataProduct ?? null,
    envProduct: envProduct ?? null,
  })
}

export function evaluateCachedLimits(remaining: number): CachedLimitsEvaluation {
  return dispatchSync('evaluateCachedLimits', { remaining })
}

export function evaluateFreshLimits(
  withinLimits: boolean,
  remaining: number,
): FreshLimitsEvaluation {
  return dispatchSync('evaluateFreshLimits', { withinLimits, remaining })
}

export function decidePaywallOutcome<TGate>(input: {
  withinLimits: boolean
  product: string
  limits: PaywallDecisionLimits | null
  checkoutUrl?: string
  buildGate: (product: string, limits: PaywallDecisionLimits) => TGate
}): PaywallOutcome<TGate> {
  // Rust owns the gate build (in-crate `build_paywall_gate`); `buildGate` is
  // ignored — kept in the signature for source compatibility.
  return dispatchSync('decidePaywallOutcome', {
    withinLimits: input.withinLimits,
    product: input.product,
    limits: input.limits,
    checkoutUrl: input.checkoutUrl ?? null,
  })
}

export function resolveFallbackGateLimits(checkoutUrl?: string): PaywallDecisionLimits {
  return dispatchSync('resolveFallbackGateLimits', { checkoutUrl: checkoutUrl ?? null })
}

// --- paywall state / gate / payload ---

export function classifyPaywallState(limits: LimitResponseWithPlan | null): PaywallState {
  return dispatchSync('classifyPaywallState', { limits })
}

export function buildGateMessage(state: PaywallState, gate: PaywallStructuredContent): string {
  return dispatchSync('buildGateMessage', { state, gate })
}

export function buildNudgeMessage(
  state: PaywallState,
  limits: LimitResponseWithPlan | null,
): string {
  return dispatchSync('buildNudgeMessage', { state, limits })
}

type LimitsLike = Omit<LimitResponseWithPlan, 'plan'> & {
  plan?: LimitResponseWithPlan['plan']
}

export function buildPaywallGate(
  productRef: string,
  limits: LimitsLike,
): PaywallStructuredContent {
  return dispatchSync('buildPaywallGate', { productRef, limits })
}

export function paywallErrorToClientPayload(error: PaywallErrorLike): Record<string, unknown> {
  return dispatchSync('paywallErrorToClientPayload', {
    message: error.message,
    structuredContent: error.structuredContent,
  })
}

// --- retry ---

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
  return dispatchSync('retryNextDelayMs', options)
}
