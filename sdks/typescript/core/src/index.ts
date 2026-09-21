import { z } from 'zod'

import { SolvaPayError } from './solvapay-error'
export { SolvaPayError }
export { reconstructSolvaPayEnvelopeError, unwrapEnvelope, type EnvelopeError } from './envelope'

export const Env = z.object({
  SOLVAPAY_SECRET_KEY: z.string().min(1),
  SOLVAPAY_API_BASE_URL: z.string().url().optional(),
})
export type Env = z.infer<typeof Env>

export interface SolvaPayConfig {
  apiKey: string
  apiBaseUrl?: string
}

/**
 * Validates and returns SolvaPay configuration from environment variables.
 *
 * Reads `SOLVAPAY_SECRET_KEY` and optional `SOLVAPAY_API_BASE_URL` from
 * environment variables and returns a validated configuration object.
 *
 * @returns SolvaPayConfig object with apiKey and optional apiBaseUrl
 * @throws {SolvaPayError} If SOLVAPAY_SECRET_KEY is missing
 *
 * @example
 * ```typescript
 * import { getSolvaPayConfig } from '@solvapay/core';
 *
 * try {
 *   const config = getSolvaPayConfig();
 *   console.log('API Key configured:', config.apiKey);
 * } catch (error) {
 *   console.error('Configuration error:', error.message);
 * }
 * ```
 *
 * @see {@link SolvaPayConfig} for the return type
 * @see {@link SolvaPayError} for error handling
 * @since 1.0.0
 */
export function getSolvaPayConfig(): SolvaPayConfig {
  const solvapaySecretKey = process.env.SOLVAPAY_SECRET_KEY
  const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL

  if (!solvapaySecretKey) {
    throw new SolvaPayError(
      'Server configuration error: SolvaPay secret key not configured. Missing SOLVAPAY_SECRET_KEY environment variable.',
      { code: 'missing_api_key' },
    )
  }

  return {
    apiKey: solvapaySecretKey,
    apiBaseUrl: solvapayApiBaseUrl,
  }
}

export {
  creditsToDisplayMinorUnits,
  isUnlimitedRemaining,
  isZeroDecimalCurrency,
  minorUnitsPerMajor,
  validateBusinessDetails,
  getCustomerAddressFieldErrors,
  isCustomerAddressComplete,
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  resolveTaxBehavior,
  getBusinessCountryOptions,
  resolveBuyerCountry,
  isPostalCodeRequired,
  isStateRequired,
  getStateFieldLabel,
  getPostalCodeFieldLabel,
  getPostalCodePlaceholder,
  getSellerTaxIdentifierDisplayLabel,
  getSellerTaxIdentifierDisplayLabelByType,
  resolveSellerIdentityDisplay,
  shouldShowTaxRow,
  formatSubtotalLabel,
  formatVatSummaryLabel,
  resolveTaxTreatmentNote,
  formatPrice,
  toMajorUnits,
  TOPUP_BALANCE_POLL_DELAYS_MS,
  BALANCE_RECONCILE_DELAYS_MS,
  installNativeCoreApi,
  resetNativeCoreApiForTests,
} from './native-core'

export type {
  AllowConsequence,
  ActiveProduct,
  AuthResolutionInput,
  AuthenticatedUser,
  BillingCycle,
  BillingInterval,
  Charge,
  ChargePer,
  CreditSignals,
  CustomerSnapshot,
  DefaultMcpBearerExpectations,
  GateAction,
  GateCacheOp,
  GateNextOutput,
  McpDisplayModeState,
  PaywallNextAction,
  PlanPricingShape,
  Tier,
  TierMode,
  UsageExtra,
  UsageRate,
} from './types/boundary.generated'

export type {
  BalancePegLike,
  BillingCycleLike,
  ChargeLike,
  PricedLike,
  PricingOptionLike,
  TierLike,
} from './pricing-options-types'

export {
  BusinessDetailsSchema,
  BUSINESS_COUNTRY_DISPLAY_NAMES,
  BUSINESS_COUNTRY_OPTIONS,
  COUNTRY_TO_TAX_ID_TYPE,
  POSTAL_CODE_REQUIRED_COUNTRIES,
  STATE_REQUIRED_COUNTRIES,
  SUPPORTED_BUSINESS_COUNTRIES,
  TAX_BEHAVIORS,
  TAX_EXCLUSIVE_CURRENCIES,
  TAX_ID_EXAMPLE_BY_COUNTRY,
  TAX_ID_TYPES,
  isTaxIdType,
  type BusinessCountryOption,
  type BusinessDetails,
  type BusinessDetailsInput,
  type BusinessDetailsValidationError,
  type BusinessDetailsValidationIssue,
  type EuMemberCountry,
  type SupportedBusinessCountry,
  type TaxBehavior,
  type TaxBreakdown,
  type TaxIdType,
  type ValidateBusinessDetailsResult,
} from './business-details'

export {
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  type SellerIdentityDisplay,
  type SellerIdentityRow,
} from './seller-identity'

export { REVERSE_CHARGE_NOTE, TAX_NOT_COLLECTED_NOTE } from './tax-summary'

export {
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  assertValidProductRef,
  evaluateProductReadiness,
  type ProductReadinessInput,
  type ProductReadinessResult,
} from './product-readiness'

export * from './barrel.generated'

export {
  type CoercedCustomerOptions,
  type CreateCustomerParams,
  type CreateErrorKind,
  type CustomerRefKind,
  type LookupErrorKind,
} from './customer-sync'

export { type ActivatePlanValidationError } from './activation'

export {
  type PaymentHelperError,
  type PaymentIntentProjection,
  type PaymentIntentSource,
  type TopupProcessOutcome,
} from './payment'

export { type CheckoutHelperError } from './checkout'

export { isRenewalError, type RenewalHelperError } from './renewal'

export { type UsageSnapshot, type UsageSnapshotPurchase } from './usage'

export {
  type CheckLimitsParams,
  type FreeLimit,
  type FreeLimitInput,
  type FreeLimitScope,
  type LimitsHelperError,
} from './limits'

export { type PlansHelperError } from './plans'

export { type RouteErrorInput, type RouteErrorKind, type RouteErrorResult } from './error'

export { type ProductHelperError } from './product'

export {
  type CachedLimitsEvaluation,
  type FreshLimitsEvaluation,
  type PaywallDecisionLimits,
  type PaywallOutcome,
} from './paywall-decision'

export const version = '0.1.0'
