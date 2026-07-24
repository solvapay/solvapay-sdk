import { z } from 'zod'

import { SolvaPayError } from './solvapay-error'
export { SolvaPayError }

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
    )
  }

  return {
    apiKey: solvapaySecretKey,
    apiBaseUrl: solvapayApiBaseUrl,
  }
}

export {
  creditsToDisplayMinorUnits,
  isZeroDecimalCurrency,
  minorUnitsPerMajor,
  validateBusinessDetails,
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  resolveTaxBehavior,
  getBusinessCountryOptions,
  getSellerTaxIdentifierDisplayLabel,
  getSellerTaxIdentifierDisplayLabelByType,
  resolveSellerIdentityDisplay,
  installNativeCoreApi,
} from './native-core'

export {
  BusinessDetailsSchema,
  BUSINESS_COUNTRY_DISPLAY_NAMES,
  BUSINESS_COUNTRY_OPTIONS,
  COUNTRY_TO_TAX_ID_TYPE,
  SUPPORTED_BUSINESS_COUNTRIES,
  TAX_BEHAVIORS,
  TAX_EXCLUSIVE_CURRENCIES,
  TAX_ID_EXAMPLE_BY_COUNTRY,
  TAX_ID_TYPES,
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

export {
  buildCreateCustomerParams,
  classifyCreateError,
  classifyCustomerRef,
  classifyLookupError,
  coerceCustomerOptions,
  extractBackendCustomerRef,
  isEmailConflict,
  validateActivatePlanParams,
  attachBusinessDetailsValidationError,
  projectPaymentIntentResult,
  projectTopupProcessOutcome,
  validateAttachBusinessDetailsParams,
  validateCreatePaymentIntentParams,
  validateProcessPaymentIntentParams,
  validateTopupPaymentIntentParams,
  resolveReturnUrl,
  validateCheckoutSessionParams,
  isCachedCustomerRefValid,
  resolvePurchaseCustomerRef,
  selectActivePurchases,
  classifyCancelError,
  classifyReactivateError,
  normalizeCancelResponse,
  normalizeReactivateResponse,
  validatePurchaseRef,
  projectUsageSnapshot,
  resolveCheckLimitsParams,
  validateListPlansParams,
  isErrorResult,
  mapRouteError,
  validateGetProductParams,
  decidePaywallOutcome,
  evaluateCachedLimits,
  evaluateFreshLimits,
  resolveFallbackGateLimits,
  resolveProductRef,
} from './native-helpers'

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

export {
  isRenewalError,
  type RenewalHelperError,
} from './renewal'

export {
  type UsageSnapshot,
  type UsageSnapshotPurchase,
} from './usage'

export {
  type CheckLimitsParams,
  type LimitsHelperError,
} from './limits'

export { type PlansHelperError } from './plans'

export {
  type RouteErrorInput,
  type RouteErrorKind,
  type RouteErrorResult,
} from './error'

export { type ProductHelperError } from './product'

export {
  type CachedLimitsEvaluation,
  type FreshLimitsEvaluation,
  type PaywallDecisionLimits,
  type PaywallOutcome,
} from './paywall-decision'

export const version = '0.1.0'
