/**
 * Hosted SolvaPay legal pages.
 *
 * `LegalFooter` always points here. `MandateText` always names these as
 * SolvaPay's Terms of Service and Privacy Policy; merchant URLs from
 * `/api/merchant` are added alongside them when set, never as a
 * substitute. SolvaPay is the processor on every charge, so its terms
 * always apply.
 *
 * These are the core helpers. Call them when rendering so importing this
 * module does not require the native core to be installed yet.
 */

export {
  solvapayTermsUrl as SOLVAPAY_TERMS_URL,
  solvapayPrivacyUrl as SOLVAPAY_PRIVACY_URL,
  solvapayWebsiteUrl as SOLVAPAY_WEBSITE_URL,
} from '@solvapay/core'
