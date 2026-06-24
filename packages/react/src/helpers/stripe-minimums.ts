/**
 * Per-currency Stripe minimum charge amounts in minor units.
 *
 * Mirrored from the backend source of truth
 * (`solvapay-backend/src/billing/credits/lib/stripe-minimum-charge.ts`). Keep the
 * two tables in sync — the SDK validates client-side so users get an accurate,
 * currency-correct minimum before the request reaches the server.
 */
const STRIPE_MINIMUM_MINOR: Record<string, number> = {
  USD: 50,
  EUR: 50,
  GBP: 30,
  SEK: 300,
  NOK: 300,
  DKK: 250,
  CHF: 50,
  CAD: 50,
  AUD: 50,
  JPY: 50,
  KRW: 500,
}

const DEFAULT_MINIMUM_MINOR = 50

export function getStripeMinimumMinor(currency: string): number {
  return STRIPE_MINIMUM_MINOR[currency.toUpperCase()] ?? DEFAULT_MINIMUM_MINOR
}
