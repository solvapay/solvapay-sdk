/**
 * Payment helper types (Step 52). Helpers are Rust-only in `native-helpers.ts`.
 */

export type PaymentHelperError = { error: string; status: number }

export type PaymentIntentProjection = {
  processorPaymentId: string
  clientSecret: string
  publishableKey: string
  accountId?: string
  customerRef: string
}

export type PaymentIntentSource = {
  processorPaymentId: string
  clientSecret: string
  publishableKey: string
  accountId?: string
}

export type TopupProcessOutcome =
  | { status: 'timeout'; message?: string }
  | { status: 'failed' }
  | { status: 'cancelled' }
  | { status: 'succeeded' }
