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
    expiresOn: string
    validIndefinitely: string
    /** "Started {date}" — purchase start-date line on `<CurrentPlanCard>`. */
    startedOn: string
    paymentMethod: string
    paymentMethodExpires: string
    noPaymentMethod: string
    updatePaymentButton: string
    /**
     * Fine-print rendered beneath `<CurrentPlanCard>` in the MCP account
     * view, where the inline Update / Cancel actions are hidden in favour
     * of a single "Manage account" CTA. Tells the user where those
     * actions moved.
     */
    portalHint: string
    /**
     * Human-readable unit names for `billingCycle`, used as the `interval`
     * arg to `formatPrice` so a monthly SEK plan renders "500 kr / month"
     * rather than "500 kr / monthly".
     */
    cycleUnit: {
      weekly: string
      monthly: string
      quarterly: string
      yearly: string
    }
  }
  /**
   * MCP `<McpAccountView>` strings — the product/plan focus surface.
   * Other surfaces continue to use surface-specific keys (`activation`,
   * `paywall`, `usage`, etc.).
   */
  account: {
    /** Section label above the active plan card. Uppercased in CSS. */
    currentPlanAndUsage: string
    /** aria-label for the inline refresh icon button. */
    refreshLabel: string
    /** Heading for the in-card pay-as-you-go credits state. */
    payAsYouGoTitle: string
    /** Body copy for the in-card pay-as-you-go credits state. */
    payAsYouGoBody: string
    /** Heading for the in-card "no active plan" state. */
    noPlanTitle: string
    /** Body copy for the in-card "no active plan" state. */
    noPlanBody: string
    /** Inline CTA on the pay-as-you-go state that switches to the Plan tab. */
    seePlansButton: string
    /** Primary CTA on the no-plan state that switches to the Plan tab. */
    pickPlanButton: string
  }
  customerPortal: {
    launchButton: string
    loadingLabel: string
  }
  /**
   * `<McpCheckoutView>` chrome strings that aren't owned by the
   * sub-flows (`planSelector`, `activationFlow`, `paywall`). Currently
   * only the in-iframe back-link surfaced when `<McpAppShell>` owns
   * surface routing.
   */
  checkout: {
    /**
     * Label for the BackLink at the top of the plan-selector step.
     * Wired by `<McpAppShell>` whenever the user reached checkout
     * in-session (e.g. via `Pick a plan` on `<McpAccountView>`).
     */
    backToAccount: string
  }
  legalFooter: {
    terms: string
    privacy: string
    providedBy: string
    poweredBy: string
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
    paymentConfirmationDelayed: string
    paymentStatusPrefix: string
    paywallInvalidContent: string
    usageLoadFailed: string
  }
  paywall: {
    header: string
    paymentRequiredHeading: string
    activationRequiredHeading: string
    resolvedHeading: string
    productContext: string
    balanceLine: string
    paymentRequiredMessage: string
    paymentRequiredMessageRemaining: string
    paymentRequiredProductSuffix: string
    retryButton: string
    hostedCheckoutButton: string
    hostedCheckoutLoading: string
  }
  usage: {
    header: string
    percentUsedLabel: string
    usedLabel: string
    remainingLabel: string
    unlimitedLabel: string
    resetsInLabel: string
    resetsOnLabel: string
    loadingLabel: string
    emptyLabel: string
    approachingLimit: string
    atLimit: string
    topUpCta: string
    upgradeCta: string
    refreshCta: string
  }
}

/**
 * Deep-partial type for consumer overrides — every nested key is optional so
 * integrators can override only the strings they care about.
 */
export type PartialSolvaPayCopy = {
  [K in keyof SolvaPayCopy]?: Partial<SolvaPayCopy[K]>
}
