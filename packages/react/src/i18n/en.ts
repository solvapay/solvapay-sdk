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
    freeTier: (ctx: MandateContext) => {
      const product = ctx.product?.name ?? 'this plan'
      const planPhrase = ctx.plan?.name ? ` on ${ctx.plan.name}` : ''
      return `By confirming, you activate ${product}${planPhrase}. Payments are processed by SolvaPay.${termsSentence(ctx)}`
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
  planSelector: {
    heading: 'Choose your pricing',
    currentBadge: 'Current',
    popularBadge: 'Popular',
    freeBadge: 'Free',
    perIntervalShort: '/{interval}',
    continueButton: 'Continue',
    backButton: '← Back to plans',
    trialBadge: '{trialDays}-day free trial',
  },
  amountPicker: {
    selectAmountLabel: 'Select an amount',
    customAmountLabel: 'Or enter a custom amount',
    creditEstimateExact: '= {credits} credits',
    creditEstimateApprox: '~ {credits} credits',
  },
  activationFlow: {
    heading: 'Confirm your plan',
    activateButton: 'Activate',
    activatingLabel: 'Activating...',
    topupHeading: 'Add credits',
    topupSubheading: 'Top up your credits to activate this plan.',
    continueToPayment: 'Continue to payment',
    changeAmountButton: 'Change amount',
    retryingHeading: 'Activating your plan...',
    retryingSubheading: 'Payment received. Setting up your plan.',
    activatedHeading: 'Plan selected',
    activatedSubheading: 'Your plan is now active.',
    tryAgainButton: 'Try Again',
    backButton: '← Back to plan selection',
  },
  cancelPlan: {
    button: 'Cancel plan',
    buttonLoading: 'Cancelling...',
    confirmRecurring: 'Are you sure you want to cancel your subscription?',
    confirmUsageBased:
      'Are you sure you want to deactivate your plan? This will take effect immediately.',
  },
  cancelledNotice: {
    heading: 'Your purchase has been cancelled',
    expiresLabel: 'Purchase Expires: {date}',
    daysRemaining: '{days} days remaining',
    dayRemaining: '1 day remaining',
    accessUntil:
      "You'll continue to have access to {product} features until this date",
    accessEnded: 'Your purchase access has ended',
    cancelledOn: 'Cancelled on {date}',
    reactivateButton: 'Undo Cancellation',
    reactivateButtonLoading: 'Reactivating...',
  },
  creditGate: {
    lowBalanceHeading: "You're out of credits",
    lowBalanceSubheading: 'Top up to continue using {product}',
    topUpCta: 'Top up now',
  },
  currentPlan: {
    heading: 'Your plan',
    nextBilling: 'Next billing: {date}',
    expiresOn: 'Expires {date}',
    validIndefinitely: 'Valid indefinitely',
    startedOn: 'Started {date}',
    paymentMethod: '{brand} •••• {last4}',
    paymentMethodExpires: 'expires {month}/{year}',
    noPaymentMethod: 'No payment method on file',
    updatePaymentButton: 'Update card',
    portalHint: 'Click Manage account to update your card or cancel your plan.',
    cycleUnit: {
      weekly: 'week',
      monthly: 'month',
      quarterly: '3 months',
      yearly: 'year',
    },
  },
  account: {
    currentPlanAndUsage: 'Current plan and usage',
    refreshLabel: 'Refresh',
    payAsYouGoTitle: "You're on pay-as-you-go credits",
    payAsYouGoBody:
      'Top up to keep going, or pick a plan for predictable monthly billing.',
    noPlanTitle: "You don't have an active plan",
    noPlanBody: 'Pick a plan — free, pay-as-you-go, or paid — to get started.',
    seePlansButton: 'See plans',
    pickPlanButton: 'Pick a plan',
  },
  customerPortal: {
    launchButton: 'Manage account',
    loadingLabel: 'Loading portal…',
  },
  checkout: {
    backToAccount: 'Back to my account',
  },
  legalFooter: {
    terms: 'Terms',
    privacy: 'Privacy',
    providedBy: 'Provided by SolvaPay',
    poweredBy: 'Powered by SolvaPay',
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
    paymentConfirmationDelayed:
      'Payment succeeded but confirmation is taking longer than usual. Refresh in a moment to see your purchase.',
    paymentStatusPrefix: 'Payment status: {status}',
    paywallInvalidContent: 'Paywall content is missing or malformed.',
    usageLoadFailed: 'Failed to load usage',
  },
  paywall: {
    header: 'Unlock access',
    paymentRequiredHeading: 'Upgrade to continue',
    activationRequiredHeading: 'Add credits to continue',
    resolvedHeading: 'You can continue',
    productContext: 'For {product}',
    balanceLine: 'You have {available} credits, need {required}.',
    paymentRequiredMessage:
      "You've used all your included calls{forProduct}. Choose a plan below to keep going.",
    paymentRequiredMessageRemaining:
      'Only {remaining} call{pluralSuffix} left{forProduct}. Choose a plan below to keep going.',
    paymentRequiredProductSuffix: ' for {product}',
    retryButton: 'Continue',
    hostedCheckoutButton: 'Open checkout',
    hostedCheckoutLoading: 'Loading checkout…',
  },
  usage: {
    header: 'Usage',
    percentUsedLabel: '{percent}% used',
    usedLabel: '{used} / {total} {unit}',
    remainingLabel: '{remaining} {unit} remaining',
    unlimitedLabel: 'Unlimited',
    resetsInLabel: 'Resets in {days} days',
    resetsOnLabel: 'Resets {date}',
    loadingLabel: 'Loading usage…',
    emptyLabel: 'No usage-based plan is active.',
    approachingLimit: "You're approaching your usage limit.",
    atLimit: "You've reached your usage limit.",
    topUpCta: 'Add credits',
    upgradeCta: 'Upgrade plan',
    refreshCta: 'Refresh',
  },
}
