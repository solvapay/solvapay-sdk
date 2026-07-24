/**
 * Sync helper pure-logic facade (Step 52).
 *
 * Phase-4/5 decision helpers dispatch to napi / WASM via the shared
 * {@link dispatchSync} install. No TypeScript fallback — uninstalled or
 * `SOLVAPAY_IMPL=ts` throws.
 */

import { dispatchSync } from './native-dispatch'
import type {
  ActivatePlanValidationError,
} from './activation'
import type {
  CheckoutHelperError,
} from './checkout'
import type {
  CoercedCustomerOptions,
  CreateCustomerParams,
  CreateErrorKind,
  CustomerRefKind,
  LookupErrorKind,
} from './customer-sync'
import type {
  RouteErrorInput,
  RouteErrorResult,
} from './error'
import type {
  CheckLimitsParams,
  LimitsHelperError,
} from './limits'
import type {
  CachedLimitsEvaluation,
  FreshLimitsEvaluation,
  PaywallDecisionLimits,
  PaywallOutcome,
} from './paywall-decision'
import type {
  PaymentHelperError,
  PaymentIntentProjection,
  PaymentIntentSource,
  TopupProcessOutcome,
} from './payment'
import type {
  PlansHelperError,
} from './plans'
import type {
  ProductHelperError,
} from './product'
import type {
  RenewalHelperError,
} from './renewal'
import type {
  UsageSnapshot,
  UsageSnapshotPurchase,
} from './usage'

// --- customer-sync ---

export function classifyCustomerRef(customerRef: string): CustomerRefKind {
  return dispatchSync('classifyCustomerRef', { customerRef })
}

export function coerceCustomerOptions(
  email: string | null | undefined,
  name: string | null | undefined,
): CoercedCustomerOptions {
  return dispatchSync('coerceCustomerOptions', {
    email: email ?? null,
    name: name ?? null,
  })
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

export function validateCheckoutSessionParams(
  productRef: string | null | undefined,
): CheckoutHelperError | null {
  return dispatchSync('validateCheckoutSessionParams', {
    productRef: productRef ?? null,
  })
}

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

// --- purchase ---

export function selectActivePurchases<T extends { status?: string }>(purchases: T[]): T[] {
  return dispatchSync('selectActivePurchases', { purchases })
}

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
  return dispatchSync('resolvePurchaseCustomerRef', {
    customerRef: customerRef ?? null,
    userId,
  })
}

// --- renewal (isRenewalError stays in renewal.ts) ---

export function validatePurchaseRef(
  purchaseRef: string | null | undefined,
): RenewalHelperError | null {
  return dispatchSync('validatePurchaseRef', { purchaseRef: purchaseRef ?? null })
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

export function classifyCancelError(message: string): RenewalHelperError {
  return dispatchSync('classifyCancelError', { message })
}

export function classifyReactivateError(message: string): RenewalHelperError {
  return dispatchSync('classifyReactivateError', { message })
}

// --- usage ---

export function projectUsageSnapshot(
  activePurchase: UsageSnapshotPurchase | null | undefined,
): UsageSnapshot {
  return dispatchSync('projectUsageSnapshot', {
    activePurchase: activePurchase ?? null,
  })
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
  return dispatchSync('validateListPlansParams', {
    productRef: productRef ?? null,
  })
}

// --- error ---

export function mapRouteError(input: RouteErrorInput): RouteErrorResult {
  return dispatchSync('mapRouteError', {
    kind: input.kind,
    message: input.message,
    defaultMessage: input.defaultMessage ?? null,
    operationName: input.operationName,
    status: input.status ?? null,
  })
}

export function isErrorResult(result: unknown): result is RouteErrorResult {
  return dispatchSync('isErrorResult', { result })
}

// --- product ---

export function validateGetProductParams(
  productRef: string | null | undefined,
): ProductHelperError | null {
  return dispatchSync('validateGetProductParams', {
    productRef: productRef ?? null,
  })
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

export function resolveFallbackGateLimits(checkoutUrl?: string): PaywallDecisionLimits {
  return dispatchSync('resolveFallbackGateLimits', {
    checkoutUrl: checkoutUrl ?? null,
  })
}

/**
 * Produce allow vs gate at the decision point.
 *
 * `buildGate` is accepted for API compatibility with the former TS body; the
 * Rust path ignores it and uses in-crate `build_paywall_gate`.
 */
export function decidePaywallOutcome<TGate>(input: {
  withinLimits: boolean
  product: string
  limits: PaywallDecisionLimits | null
  checkoutUrl?: string
  buildGate: (product: string, limits: PaywallDecisionLimits) => TGate
}): PaywallOutcome<TGate> {
  return dispatchSync('decidePaywallOutcome', {
    withinLimits: input.withinLimits,
    product: input.product,
    limits: input.limits,
    checkoutUrl: input.checkoutUrl ?? null,
  })
}
