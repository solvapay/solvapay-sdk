import { z } from 'zod'

export const Env = z.object({
  SOLVAPAY_SECRET_KEY: z.string().min(1),
  SOLVAPAY_API_BASE_URL: z.string().url().optional(),
})
export type Env = z.infer<typeof Env>

/**
 * Base error class for SolvaPay SDK errors.
 *
 * All SolvaPay SDK errors extend this class, making it easy to catch
 * and handle SDK-specific errors separately from other errors.
 *
 * @example
 * ```typescript
 * import { SolvaPayError } from '@solvapay/core';
 *
 * try {
 *   const config = getSolvaPayConfig();
 * } catch (error) {
 *   if (error instanceof SolvaPayError) {
 *     // Handle SolvaPay-specific error
 *     console.error('SolvaPay error:', error.message);
 *   } else {
 *     // Handle other errors
 *     throw error;
 *   }
 * }
 * ```
 *
 * @since 1.0.0
 */
export class SolvaPayError extends Error {
  /**
   * HTTP status code associated with the error, when the error
   * originated from an upstream API response. Optional so existing
   * `new SolvaPayError(message)` callsites stay valid.
   */
  readonly status?: number

  /**
   * Optional short code for programmatic branching (e.g.
   * `'missing_secret'`, `'merchant_not_found'`). Free-form by design;
   * callers should not depend on an exhaustive enum.
   */
  readonly code?: string

  /**
   * Creates a new SolvaPayError instance.
   *
   * @param message - Error message
   * @param init - Optional `{ status, code }` metadata. Both fields
   *   are preserved on the instance so downstream consumers
   *   (`handleRouteError`, MCP trace wrappers) can branch on HTTP
   *   status without parsing the message string.
   */
  constructor(message: string, init: { status?: number; code?: string } = {}) {
    super(message)
    this.name = 'SolvaPayError'
    this.status = init.status
    this.code = init.code
  }
}

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
} from './credit-display'

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
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  resolveTaxBehavior,
  validateBusinessDetails,
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
  getSellerTaxIdentifierDisplayLabel,
  resolveSellerIdentityDisplay,
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
  type CoercedCustomerOptions,
  type CreateCustomerParams,
  type CreateErrorKind,
  type CustomerRefKind,
  type LookupErrorKind,
} from './customer-sync'

export {
  validateActivatePlanParams,
  type ActivatePlanValidationError,
} from './activation'

export {
  attachBusinessDetailsValidationError,
  projectPaymentIntentResult,
  projectTopupProcessOutcome,
  validateAttachBusinessDetailsParams,
  validateCreatePaymentIntentParams,
  validateProcessPaymentIntentParams,
  validateTopupPaymentIntentParams,
  type PaymentHelperError,
  type PaymentIntentProjection,
  type PaymentIntentSource,
  type TopupProcessOutcome,
} from './payment'

export {
  resolveReturnUrl,
  validateCheckoutSessionParams,
  type CheckoutHelperError,
} from './checkout'

export {
  isCachedCustomerRefValid,
  resolvePurchaseCustomerRef,
  selectActivePurchases,
} from './purchase'

export {
  classifyCancelError,
  classifyReactivateError,
  isRenewalError,
  normalizeCancelResponse,
  normalizeReactivateResponse,
  validatePurchaseRef,
  type RenewalHelperError,
} from './renewal'

export {
  projectUsageSnapshot,
  type UsageSnapshot,
  type UsageSnapshotPurchase,
} from './usage'

export {
  resolveCheckLimitsParams,
  type CheckLimitsParams,
  type LimitsHelperError,
} from './limits'

export { validateListPlansParams, type PlansHelperError } from './plans'

export {
  isErrorResult,
  mapRouteError,
  type RouteErrorInput,
  type RouteErrorKind,
  type RouteErrorResult,
} from './error'

export {
  validateGetProductParams,
  type ProductHelperError,
} from './product'

export {
  decidePaywallOutcome,
  evaluateCachedLimits,
  evaluateFreshLimits,
  resolveFallbackGateLimits,
  resolveProductRef,
  type CachedLimitsEvaluation,
  type FreshLimitsEvaluation,
  type PaywallDecisionLimits,
  type PaywallOutcome,
} from './paywall-decision'

export const version = '0.1.0'
