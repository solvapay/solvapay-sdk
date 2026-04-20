/**
 * Typed copy bundle surfaced through `<SolvaPayProvider config={{ copy }} />`.
 *
 * Every user-visible string in `@solvapay/react` routes through this bundle via
 * `useCopy()`. Values are either plain templates with `{placeholder}` tokens or
 * function-form resolvers (currently only used for mandate variants) that
 * receive a `MandateContext` and return the final string.
 */

export type MandateContext = {
  merchant: {
    legalName: string
    displayName?: string
    supportEmail?: string
    termsUrl?: string
    privacyUrl?: string
  }
  plan?: {
    name?: string
    interval?: string
    intervalCount?: number
    trialDays?: number
    measures?: string
    billingCycle?: string
  }
  product?: {
    name?: string
  }
  amountFormatted: string
  trialDays?: number
}

export type MandateTemplate = string | ((ctx: MandateContext) => string)

export interface SolvaPayCopy {
  mandate: {
    recurring: MandateTemplate
    oneTime: MandateTemplate
    topup: MandateTemplate
    usageMetered: MandateTemplate
    freeTier: MandateTemplate
  }
  cta: {
    payNow: string
    topUp: string
    subscribe: string
    trialStart: string
    payAmount: string
    addAmount: string
    startUsing: string
    processing: string
  }
  interval: {
    day: string
    week: string
    month: string
    year: string
    every: string
    free: string
    trial: string
  }
  terms: {
    checkboxLabel: string
  }
  customer: {
    chargingTo: string
    emailLabel: string
    nameLabel: string
  }
  balance: {
    credits: string
    currencyEquivalent: string
  }
  product: {
    currentProductLabel: string
  }
  topup: {
    selectOrEnterAmount: string
    minAmount: string
    maxAmount: string
  }
  activation: {
    paymentRequired: string
    invalidConfiguration: string
    unexpectedResponse: string
    failed: string
  }
  planSelector: {
    heading: string
    currentBadge: string
    popularBadge: string
    freeBadge: string
    perIntervalShort: string
    continueButton: string
    backButton: string
    trialBadge: string
  }
  amountPicker: {
    selectAmountLabel: string
    customAmountLabel: string
    creditEstimateExact: string
    creditEstimateApprox: string
  }
  activationFlow: {
    heading: string
    activateButton: string
    activatingLabel: string
    topupHeading: string
    topupSubheading: string
    continueToPayment: string
    changeAmountButton: string
    retryingHeading: string
    retryingSubheading: string
    activatedHeading: string
    activatedSubheading: string
    tryAgainButton: string
    backButton: string
  }
  cancelPlan: {
    button: string
    buttonLoading: string
    confirmRecurring: string
    confirmUsageBased: string
  }
  cancelledNotice: {
    heading: string
    expiresLabel: string
    daysRemaining: string
    dayRemaining: string
    accessUntil: string
    accessEnded: string
    cancelledOn: string
    reactivateButton: string
    reactivateButtonLoading: string
  }
  creditGate: {
    lowBalanceHeading: string
    lowBalanceSubheading: string
    topUpCta: string
  }
  currentPlan: {
    heading: string
    nextBilling: string
    renewsOn: string
    expiresOn: string
    validIndefinitely: string
    paymentMethod: string
    paymentMethodExpires: string
    noPaymentMethod: string
    updatePaymentButton: string
  }
  customerPortal: {
    launchButton: string
    loadingLabel: string
  }
  errors: {
    paymentInitFailed: string
    topupInitFailed: string
    configMissingPlanOrProduct: string
    configMissingAmount: string
    unknownError: string
    stripeUnavailable: string
    paymentIntentUnavailable: string
    cardElementMissing: string
    paymentUnexpected: string
    paymentProcessingFailed: string
    paymentRequires3ds: string
    paymentProcessingTimeout: string
    paymentStatusPrefix: string
  }
}

/**
 * Deep-partial type for consumer overrides — every nested key is optional so
 * integrators can override only the strings they care about.
 */
export type PartialSolvaPayCopy = {
  [K in keyof SolvaPayCopy]?: Partial<SolvaPayCopy[K]>
}
