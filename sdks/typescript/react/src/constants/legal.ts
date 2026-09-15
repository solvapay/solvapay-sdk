/**
 * Hosted SolvaPay legal pages used as universal fallbacks.
 *
 * The merchant record returned from `/api/merchant` is allowed to omit
 * `termsUrl` / `privacyUrl`. When that happens, primitives that surface
 * legal copy (`LegalFooter`, `MandateText`) link to these SolvaPay-hosted
 * pages so the customer always has a working terms / privacy reference at
 * the point of charge — SolvaPay is the underlying payment processor and
 * its terms always apply.
 */

export const SOLVAPAY_TERMS_URL = 'https://solvapay.com/legal/terms'
export const SOLVAPAY_PRIVACY_URL = 'https://solvapay.com/legal/privacy'
export const SOLVAPAY_WEBSITE_URL = 'https://solvapay.com'
