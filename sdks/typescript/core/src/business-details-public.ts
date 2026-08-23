/**
 * Public business-details API without Zod schema exports.
 * Use this entry (`@solvapay/core/business-details`) in TS 4.x consumers.
 *
 * Function exports are Rust-only facades (Step 52) — require
 * `installNativeCoreApi` (Node) or eager `@solvapay/core/browser-wasm` (browser).
 */
export {
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
  deriveTaxIdType,
  getTaxIdExample,
  getTaxIdFieldLabel,
  getTaxIdHelperText,
  resolveTaxBehavior,
  validateBusinessDetails,
  getSellerTaxIdentifierDisplayLabel,
  resolveSellerIdentityDisplay,
} from './native-core'

export {
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE,
  type SellerIdentityDisplay,
  type SellerIdentityRow,
} from './seller-identity'
