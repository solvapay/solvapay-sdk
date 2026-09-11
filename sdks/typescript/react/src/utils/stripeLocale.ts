import type { StripeElementLocale } from '@stripe/stripe-js'

/** Locales supported by Stripe Payment Element (subset of BCP-47 tags Stripe accepts). */
const STRIPE_ELEMENT_LOCALES = new Set<string>([
  'auto',
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'en-AU',
  'en-CA',
  'en-NZ',
  'en-GB',
  'es',
  'es-ES',
  'es-419',
  'et',
  'fi',
  'fr',
  'fr-CA',
  'fr-FR',
  'he',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'ms',
  'mt',
  'nb',
  'nl',
  'no',
  'pl',
  'pt',
  'pt-BR',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'th',
  'tr',
  'vi',
  'zh',
  'zh-HK',
  'zh-TW',
])

function isStripeElementLocale(value: string): value is StripeElementLocale {
  return STRIPE_ELEMENT_LOCALES.has(value)
}

/** Map a SolvaPay locale string to a Stripe Elements locale, or undefined when unsupported. */
export function toStripeElementLocale(locale: string | undefined): StripeElementLocale | undefined {
  if (!locale) return undefined
  if (isStripeElementLocale(locale)) return locale
  const base = locale.split('-')[0]
  if (isStripeElementLocale(base)) return base
  return undefined
}
