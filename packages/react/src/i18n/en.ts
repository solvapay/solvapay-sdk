import type { MandateContext, SolvaPayCopy } from './types'

function intervalPhrase(ctx: MandateContext): string {
  const interval = ctx.plan?.interval
  const count = ctx.plan?.intervalCount ?? 1
  if (!interval) return ''
  return count > 1 ? `${count} ${interval}s` : interval
}

function trialPhrase(ctx: MandateContext): string {
  const trialDays = ctx.plan?.trialDays ?? ctx.trialDays
  return trialDays ? ` after your ${trialDays}-day free trial` : ''
}

function termsSentence(ctx: MandateContext): string {
  const { termsUrl, privacyUrl } = ctx.merchant
  if (termsUrl && privacyUrl) {
    return ` See ${termsUrl} and ${privacyUrl}.`
  }
  if (termsUrl) return ` See ${termsUrl}.`
  if (privacyUrl) return ` See ${privacyUrl}.`
  return ''
}

/**
 * Canonical English copy. Preserves the exact copy shipped before the i18n
 * refactor so no visible behavior changes for English consumers.
 */
export const enCopy: SolvaPayCopy = {
  mandate: {
    recurring: (ctx: MandateContext) => {
      const period = intervalPhrase(ctx)
      const trial = trialPhrase(ctx)
      const every = period ? ` every ${period}` : ''
      return `By subscribing, you authorize ${ctx.merchant.legalName} to charge ${ctx.amountFormatted}${every}${trial} until you cancel. You can cancel any time. Payments are processed by SolvaPay.${termsSentence(ctx)}`
    },
    oneTime: (ctx: MandateContext) => {
      const product = ctx.product?.name ? ` for ${ctx.product.name}` : ''
      return `By confirming, you authorize ${ctx.merchant.legalName} to charge ${ctx.amountFormatted}${product}. Payments are processed by SolvaPay.${termsSentence(ctx)}`
    },
    topup: (ctx: MandateContext) => {
      const product = ctx.product?.name
        ? ` to add credits to your ${ctx.product.name} balance`
        : ' to add credits to your balance'
      return `By confirming, you authorize ${ctx.merchant.legalName} to charge ${ctx.amountFormatted}${product}. Credits are non-refundable once used. Payments are processed by SolvaPay.${termsSentence(ctx)}`
    },
    usageMetered: (ctx: MandateContext) => {
      const measures = ctx.plan?.measures ?? 'unit'
      const cycle = ctx.plan?.billingCycle ?? 'monthly'
      const product = ctx.product?.name ?? 'the service'
      return `By confirming, you authorize ${ctx.merchant.legalName} to charge your payment method for metered usage of ${product} at ${ctx.amountFormatted} per ${measures}, billed ${cycle}. You can cancel any time. Payments are processed by SolvaPay.${termsSentence(ctx)}`
    },
  },
  cta: {
    payNow: 'Pay Now',
    topUp: 'Top Up',
    subscribe: 'Subscribe',
    trialStart: 'Start {trialDays}-day free trial',
    payAmount: 'Pay {amount}',
    addAmount: 'Add {amount}',
    startUsing: 'Start using {product}',
    processing: 'Processing...',
  },
  interval: {
    day: 'day',
    week: 'week',
    month: 'month',
    year: 'year',
    every: 'every {n} {unit}',
    free: 'Free',
    trial: '{trialDays}-day free trial',
  },
  terms: {
    checkboxLabel: 'I agree to the terms and privacy policy',
  },
  customer: {
    chargingTo: 'Charging to {email}',
    emailLabel: 'Email',
    nameLabel: 'Name',
  },
  balance: {
    credits: ' credits',
    currencyEquivalent: ' (~{amount})',
  },
  product: {
    currentProductLabel: 'Current product: {name}',
  },
  topup: {
    selectOrEnterAmount: 'Please select or enter an amount',
    minAmount: 'Minimum amount is {amount}',
    maxAmount: 'Maximum amount is {amount}',
  },
  activation: {
    paymentRequired: 'This plan requires payment. Please select a different plan.',
    invalidConfiguration: 'Invalid plan configuration.',
    unexpectedResponse: 'Unexpected response from server.',
    failed: 'Activation failed',
  },
  errors: {
    paymentInitFailed: 'Payment initialization failed',
    topupInitFailed: 'Top-up initialization failed',
    configMissingPlanOrProduct: 'PaymentForm: either planRef or productRef is required',
    configMissingAmount: 'TopupForm: amount must be a positive number',
    unknownError: 'Unknown error',
    stripeUnavailable: 'Stripe is not available. Please refresh the page.',
    paymentIntentUnavailable: 'Payment intent not available. Please refresh the page.',
    cardElementMissing: 'Card element not found',
    paymentUnexpected: 'An unexpected error occurred.',
    paymentProcessingFailed:
      'Payment processing failed. Please try again or contact support.',
    paymentRequires3ds:
      'Payment requires additional authentication. Please complete the verification.',
    paymentProcessingTimeout:
      'Payment processing timed out — webhooks may not be configured',
    paymentStatusPrefix: 'Payment status: {status}',
  },
}
