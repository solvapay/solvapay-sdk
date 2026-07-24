/**
 * Country-aware seller identity display types + const tables.
 * Resolver functions are Rust-only facades in `native-core.ts` (Step 52).
 */

import type { TaxIdType } from './business-details'

export type SellerIdentityRow = { label: string; value: string }

export type SellerIdentityDisplay = {
  taxIdentifier: SellerIdentityRow | null
  companyNumber: SellerIdentityRow | null
}

/** Display labels for seller identity rows (distinct from form field labels). */
export const SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: Record<TaxIdType, string> = {
  eu_vat: 'VAT number',
  gb_vat: 'VAT number',
  us_ein: 'EIN',
}
