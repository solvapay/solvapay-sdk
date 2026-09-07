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
    usageRateLabel: string
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
  autoRecharge: {
    heading: string
    description: string
    settingsHeading: string
    setupTriggerLabel: string
    modifyTriggerLabel: string
    notConfiguredHint: string
    enableLabel: string
    enableQuestion: string
    enableSentence: string
    thresholdLabel: string
    thresholdAriaLabel: string
    fixedAmountLabel: string
    fixedAmountAriaLabel: string
    saveButton: string
    cancelButton: string
    disableButton: string
    savedMessage: string
    disabledMessage: string
    setupRequiredMessage: string
    setupHeading: string
    setupDescription: string
    setupSubmit: string
    setupProcessing: string
    setupAwaitingConfirmation: string
    setupAuthFailed: string
    invalidThreshold: string
    thresholdTooLow: string
    minTopupAmount: string
    topupBelowThreshold: string
    deepDrawdownExplainer: string
    invalidMaxMonthlySpend: string
    maxMonthlySpendBelowTopup: string
    maxMonthlySpendLabel: string
    maxMonthlySpendAriaLabel: string
    maxMonthlySpendPlaceholder: string
    maxMonthlySpendHelper: string
    monthlySpendLine: string
    statusMonthlyCapReached: string
    creditsPerRecharge: string
    creditsPerRechargeApprox: string
    currencyPerRecharge: string
    currencyPerRechargeApprox: string
    taxDisclosure: string
    statusFailed: string
  }
  autoRechargeView: {
    heading: string
    description: string
    thresholdLabel: string
    topupLabel: string
    maxMonthlySpendLabel: string
    maxMonthlySpendPlaceholder: string
    explainer: string
    explainerNoEstimate: string
    footerCaption: string
    cancel: string
    turnOn: string
    save: string
    turnOff: string
    statusOn: string
    back: string
    setupUnexpected: string
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
    /**
     * Field labels rendered above the otherwise bare values on
     * `<CurrentPlanCard showFieldLabels>`. A price, a usage rate and a
     * credit balance are all "a number with a currency" — without a
     * label the customer cannot tell which one they are reading.
     */
    priceFieldLabel: string
    rateFieldLabel: string
    balanceFieldLabel: string
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
    /** E upgrade link. Change plan stays the header label. */
    seePlans: string
    /** Primary CTA on the no-plan state that switches to the Plan tab. */
    pickPlanButton: string
    /** CTA on a free active plan that opens checkout to pick a paid plan. */
    upgradeButton: string
    /** CTA on a non-free active plan that opens checkout to switch plans. */
    changePlanButton: string
    /** Eyebrow above the balance hero. */
    creditBalance: string
    /** Primary top-up CTA on the account strip. */
    addFunds: string
    autoRechargeOn: string
    autoRechargeOff: string
    turnOn: string
    /** On-state link that opens the dedicated auto-recharge view. */
    manage: string
    /** Caption under auto-recharge off on a running credit plan (B). */
    autoRechargeOffCaption: string
    /** Caption under auto-recharge off when calls are already failing (D). */
    autoRechargeOffFixCaption: string
    /** Balance caption when the credit plan is at zero (D). */
    callsFailingCaption: string
    activeProducts: string
    /** Caption under the balance when a merchant name is known. */
    worksAcross: string
    /** Fullscreen identity footer. `{merchant}`. No verified suffix. */
    soldBy: string
    /** Portal text link. The button adds the external-link glyph. */
    fullHistory: string
    /** Portal text link. The button adds the external-link glyph. */
    fullAccount: string
    creditActivityEyebrow: string
    chargesEyebrow: string
    creditActivityCaption: string
    creditActivityEmpty: string
    creditActivityFailed: string
    chargesEmpty: string
    chargesFailed: string
    eventColumn: string
    whenColumn: string
    creditsColumn: string
    balanceColumn: string
    chargeColumn: string
    dateColumn: string
    amountColumn: string
    /** E upgrade prompt. `{total}` `{unit}` `{interval}`. */
    needMoreAllowance: string
    /** E upgrade caption under the See plans link. */
    upgradePaygCaption: string
    /** StatusDot label on state A. */
    noPlanStatus: string
    /** Caption under the product on state A. */
    choosePlanCaption: string
    /** Eyebrow above the A ladder. */
    plansEyebrow: string
    /** Eyebrow above the F ladder. */
    carryOnEyebrow: string
    /** Caption under the A ladder. */
    plansStartCaption: string
    /** Per-row CTA on state A. */
    activatePlanButton: string
    /** Per-row CTA on state F. */
    switchPlanButton: string
    /** Busy label on the clicked A/F ladder row. */
    activatingPlanButton: string
    /** F headline. `{plan}` `{unit}`. */
    usedUpTitle: string
    /** F body when a reset date is known. `{date}` `{days}`. */
    usedUpBody: string
    /** F body when the period has not started. */
    usedUpBodyNoDate: string
    /** F anti-trap when credits > 0. `{credits}` `{plan}`. */
    antiTrapCredits: string
    /** F wait line. `{date}` `{plan}`. */
    waitUntilReset: string
    /** StatusDot label on state H. */
    notStartedStatus: string
    /** H headline. `{total}` `{unit}` `{interval}`. */
    readyToClaim: string
    /** H caption under the headline. */
    noCardCaption: string
    /** H primary CTA. Wires `activatePlan`. */
    startFreePlan: string
    /** I body — calls succeed; no money figure. */
    stillWorking: string
    /** I upgrade link. Change plan stays off. */
    seeHigherLimit: string
    /** I used-of-allowance line. `{used}` `{total}` `{unit}`. */
    usedOfAllowance: string
    /** J StatusDot. `{date}` is month + day. */
    activeUntil: string
    /** J plan line. `{plan}` `{date}`. */
    cancelledPlanLine: string
    /** J headline. `{days}`. */
    daysLeftTitle: string
    /** J body. `{date}` is month + day. */
    cancelledBody: string
    /** J secondary CTA. `{plan}`. */
    reactivatePlan: string
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
    /**
     * Step-aware heading copy rendered by `<CheckoutSteps.StepHeading>`.
     * In paywall context, the `plan` step is overridden by the
     * `paywall.{paymentRequiredHeading|activationRequiredHeading|topupRequiredHeading}`
     * keys so the gate-reason framing is preserved at entry; the
     * `amount` and `payment` steps always read from this block.
     */
    stepHeading: {
      plan: string
      amount: string
      payment: string
    }
    /**
     * Step-aware subheading copy rendered by `<CheckoutSteps.StepMessage>`.
     * Payment-step copy is branch-aware:
     *  - `paymentRecurring` interpolates `{planName}` for subscription
     *    plans (with `billingCycle`),
     *  - `paymentOneTime` is used for one-time / lifetime plans (no
     *    `billingCycle`),
     *  - `paymentPayg` covers credit-topup payments.
     * In paywall context, the `plan` step is overridden by
     * `resolvePaywallMessage` so the gate-reason / balance framing is
     * preserved at entry.
     */
    stepMessage: {
      plan: string
      amount: string
      paymentRecurring: string
      paymentOneTime: string
      paymentPayg: string
    }
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
    paymentElementMissing: string
    /** @deprecated Use `paymentElementMissing`. Slated for removal in the next major. */
    cardElementMissing: string
    paymentUnexpected: string
    paymentPending: string
    paymentProcessingFailed: string
    paymentRequires3ds: string
    paymentProcessingTimeout: string
    paymentStatusPrefix: string
    paywallInvalidContent: string
    usageLoadFailed: string
  }
  paywall: {
    header: string
    paymentRequiredHeading: string
    /**
     * Heading for `kind: 'activation_required'` when the available
     * plans include a recurring or one-time option — i.e. the user
     * needs to activate a real plan, not just add credits.
     */
    activationRequiredHeading: string
    /**
     * Heading for `kind: 'activation_required'` when every available
     * plan is PAYG (`type: 'usage-based' | 'hybrid'`). Displayed as the
     * topup variant of the activation gate so the user sees "Add
     * credits" framing rather than generic "Activate a plan".
     */
    topupRequiredHeading: string
    resolvedHeading: string
    productContext: string
    balanceLine: string
    paymentRequiredMessage: string
    paymentRequiredMessageRemaining: string
    /**
     * Web-friendly fallback for `kind: 'payment_required'` when the
     * paywall payload has no `balance` block (e.g. the merchant's
     * server didn't surface remaining-units context). Replaces the
     * previous "Call the `upgrade` tool…" copy that bled in from the
     * MCP-flavored server `message`.
     */
    paymentRequiredMessageNoBalance: string
    /**
     * Web-friendly copy for `kind: 'activation_required'` when the
     * available plans include non-PAYG options. The user needs to pick
     * a real plan to continue.
     */
    activationRequiredMessage: string
    /**
     * Web-friendly copy for the topup variant of an activation gate —
     * `kind: 'activation_required'` where every available plan is
     * PAYG. `<PaywallNotice.Message>` resolves this when the gate's
     * `plans` are all `type: 'usage-based' | 'hybrid'`.
     */
    topupRequiredMessage: string
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
    /** FactBand eyebrows. */
    remainingEyebrow: string
    renewsEyebrow: string
    resetsEyebrow: string
    creditsEyebrow: string
    usedEyebrow: string
    /** "{remaining} {unit}" — wide Remaining headline. */
    remainingCalls: string
    /** "{remaining} of {total} {unit}" — compact Remaining value. */
    remainingOfTotal: string
    /** "Of {total} this period." */
    ofTotalThisPeriod: string
    /** "{used} of {total} {unit} used, {percent}%." */
    usedOfTotalPercent: string
    warningThresholdHint: string
    lastCallHint: string
    afterFirstCall: string
    /** FactBand Renews/Resets caption. */
    inDays: string
    notKnownYet: string
    creditsNotUsed: string
    creditsUntouched: string
    /** Fullscreen C credits caption. Widget C/E keep `creditsUntouched`. */
    creditsDoNotSpend: string
    rateConfirmedAtCheckout: string
    fromCreditsPerCall: string
    creditsPerCall: string
    /** Accent pills: D / I / F. */
    callsFailing: string
    overAllowance: string
    limitReached: string
  }
}

/**
 * Deep-partial type for consumer overrides — every nested key is optional so
 * integrators can override only the strings they care about.
 */
export type PartialSolvaPayCopy = {
  [K in keyof SolvaPayCopy]?: Partial<SolvaPayCopy[K]>
}
