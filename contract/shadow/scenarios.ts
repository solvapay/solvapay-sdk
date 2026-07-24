/**
 * Shadow-mode scenario catalog (step 25).
 *
 * Dependency-ordered: setup creates per-side product/plan/customer, then
 * scenarios run with `{placeholder}` resolution. Stripe-dependent ops are
 * marked `requires: 'stripe'` and skipped unless explicitly enabled.
 */

export type ScenarioRequires = 'stripe' | 'activePurchase'

export type ShadowScenario = {
  /** Stable id for reports. */
  id: string
  /** CamelCase operation name. */
  op: string
  /**
   * Arg template. String values may contain `{productRef}`, `{planRef}`,
   * `{customerRef}`, `{purchaseRef}`, `{paymentIntentId}`, `{email}`.
   */
  args: Record<string, unknown>
  /** Skip unless the environment supports this capability. */
  requires?: ScenarioRequires
  /** When true, expect both sides to return an error observation. */
  expectError?: boolean
  /** Human reason shown when skipped. */
  skipReason?: string
}

export type SideRefs = {
  productRef: string
  planRef: string
  customerRef: string
  email: string
  /** Unique per side+run so live unique-(provider,name) indexes do not collide. */
  sideTag: string
  purchaseRef?: string
  paymentIntentId?: string
}

/** Resolve `{placeholder}` tokens in arg templates from side-local refs. */
export function resolveArgs(
  template: Record<string, unknown>,
  refs: SideRefs,
): Record<string, unknown> {
  const map: Record<string, string> = {
    productRef: refs.productRef,
    planRef: refs.planRef,
    customerRef: refs.customerRef,
    email: refs.email,
    sideTag: refs.sideTag,
    purchaseRef: refs.purchaseRef ?? 'pur_missing_shadow',
    paymentIntentId: refs.paymentIntentId ?? 'pi_missing_shadow',
  }
  return walkResolve(template, map) as Record<string, unknown>
}

function walkResolve(value: unknown, map: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => map[key] ?? `{${key}}`)
  }
  if (Array.isArray(value)) {
    return value.map(item => walkResolve(item, map))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = walkResolve(v, map)
    }
    return out
  }
  return value
}

/**
 * Full scenario list — setup scenarios first, deletes last, stripe ops marked.
 * Covers all 36 operations at least once (success and/or error path).
 */
export const SHADOW_SCENARIOS: ShadowScenario[] = [
  // Merchant / config
  { id: 'getMerchant', op: 'getMerchant', args: {} },
  { id: 'getPlatformConfig', op: 'getPlatformConfig', args: {} },

  // Products
  {
    id: 'createProduct',
    op: 'createProduct',
    args: {
      name: 'Shadow Product Scenario {sideTag}',
      config: {},
      metadata: {},
    },
  },
  { id: 'listProducts', op: 'listProducts', args: {} },
  { id: 'getProduct', op: 'getProduct', args: { productRef: '{productRef}' } },
  {
    id: 'updateProduct',
    op: 'updateProduct',
    args: { productRef: '{productRef}', name: 'Shadow Product Updated {sideTag}' },
  },
  {
    id: 'cloneProduct',
    op: 'cloneProduct',
    args: { productRef: '{productRef}', name: 'Shadow Product Clone {sideTag}' },
  },
  {
    id: 'bootstrapMcpProduct',
    op: 'bootstrapMcpProduct',
    args: {
      // Unreachable origin — both sides should return the same error shape.
      originUrl: 'https://mcp.shadow.example.com',
      metadata: {},
    },
  },
  {
    id: 'configureMcpPlans',
    op: 'configureMcpPlans',
    args: {
      productRef: '{productRef}',
      plans: [],
    },
  },

  // Plans
  {
    id: 'createPlan',
    op: 'createPlan',
    args: {
      productRef: '{productRef}',
      name: 'Shadow Plan',
      type: 'recurring',
      billingCycle: 'monthly',
      price: 1000,
      currency: 'usd',
    },
  },
  { id: 'listPlans', op: 'listPlans', args: { productRef: '{productRef}' } },
  {
    id: 'updatePlan',
    op: 'updatePlan',
    args: {
      productRef: '{productRef}',
      planRef: '{planRef}',
      name: 'Shadow Plan Updated',
    },
  },

  // Customers / credits / balance
  {
    id: 'createCustomer',
    op: 'createCustomer',
    // Fresh email — setup already created `{email}`.
    args: { email: 'shadow-create-{sideTag}@example.com' },
  },
  {
    id: 'getCustomer',
    op: 'getCustomer',
    args: { customerRef: '{customerRef}' },
  },
  {
    id: 'updateCustomer',
    op: 'updateCustomer',
    args: { customerRef: '{customerRef}', name: 'Shadow Customer' },
  },
  {
    id: 'assignCredits',
    op: 'assignCredits',
    args: { customerRef: '{customerRef}', credits: 25 },
  },
  {
    id: 'getCustomerBalance',
    op: 'getCustomerBalance',
    args: { customerRef: '{customerRef}' },
  },
  {
    id: 'getUserInfo',
    op: 'getUserInfo',
    args: { customerRef: '{customerRef}', productRef: '{productRef}' },
  },

  // Limits / usage
  {
    id: 'checkLimits',
    op: 'checkLimits',
    args: { customerRef: '{customerRef}', productRef: '{productRef}' },
  },
  {
    id: 'trackUsage',
    op: 'trackUsage',
    args: {
      customerRef: '{customerRef}',
      actionType: 'api_call',
      units: 1,
    },
  },
  {
    id: 'trackUsageBulk',
    op: 'trackUsageBulk',
    args: {
      events: [
        {
          customerRef: '{customerRef}',
          actionType: 'api_call',
          units: 1,
        },
      ],
    },
  },

  // Sessions / activation
  {
    id: 'createCheckoutSession',
    op: 'createCheckoutSession',
    args: {
      productRef: '{productRef}',
      customerRef: '{customerRef}',
    },
  },
  {
    id: 'createCustomerSession',
    op: 'createCustomerSession',
    args: { customerRef: '{customerRef}' },
  },
  {
    id: 'activatePlan',
    op: 'activatePlan',
    args: {
      customerRef: '{customerRef}',
      productRef: '{productRef}',
      planRef: '{planRef}',
    },
  },

  // Payments (best-effort / stripe)
  {
    id: 'createPaymentIntent',
    op: 'createPaymentIntent',
    args: {
      productRef: '{productRef}',
      planRef: '{planRef}',
      customerRef: '{customerRef}',
    },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },
  {
    id: 'createTopupPaymentIntent',
    op: 'createTopupPaymentIntent',
    args: {
      customerRef: '{customerRef}',
      productRef: '{productRef}',
      amount: 500,
      currency: 'USD',
    },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },
  {
    id: 'processPaymentIntent',
    op: 'processPaymentIntent',
    args: {
      processorPaymentId: '{paymentIntentId}',
      customerRef: '{customerRef}',
    },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },
  {
    id: 'attachBusinessDetails',
    op: 'attachBusinessDetails',
    args: {
      paymentIntentId: '{paymentIntentId}',
      businessName: 'Shadow Co',
      country: 'US',
    },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },

  // Purchases
  {
    id: 'cancelPurchase',
    op: 'cancelPurchase',
    args: { purchaseRef: '{purchaseRef}' },
    requires: 'activePurchase',
    skipReason: 'requires: activePurchase',
  },
  {
    id: 'reactivatePurchase',
    op: 'reactivatePurchase',
    args: { purchaseRef: '{purchaseRef}' },
    requires: 'activePurchase',
    skipReason: 'requires: activePurchase',
  },

  // Payment method / auto-recharge
  {
    id: 'getPaymentMethod',
    op: 'getPaymentMethod',
    args: { customerRef: '{customerRef}' },
    requires: 'stripe',
    skipReason: 'requires: stripe (Stripe customer)',
  },
  {
    id: 'getAutoRecharge',
    op: 'getAutoRecharge',
    args: { customerRef: '{customerRef}' },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },
  {
    id: 'saveAutoRecharge',
    op: 'saveAutoRecharge',
    args: {
      customerRef: '{customerRef}',
      enabled: true,
      threshold: 100,
      topupAmount: 500,
    },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },
  {
    id: 'disableAutoRecharge',
    op: 'disableAutoRecharge',
    args: { customerRef: '{customerRef}' },
    requires: 'stripe',
    skipReason: 'requires: stripe',
  },

  // Error paths (identical SolvaPayError shape)
  {
    id: 'getProduct-bogus',
    op: 'getProduct',
    args: { productRef: 'prd_shadow_does_not_exist_zzzz' },
    expectError: true,
  },
  {
    id: 'getCustomer-bogus',
    op: 'getCustomer',
    args: { customerRef: 'cus_shadow_does_not_exist_zzzz' },
    expectError: true,
  },

  // Deletes last
  {
    id: 'deletePlan',
    op: 'deletePlan',
    args: { productRef: '{productRef}', planRef: '{planRef}' },
  },
  {
    id: 'deleteProduct',
    op: 'deleteProduct',
    args: { productRef: '{productRef}' },
  },
]

/** Ops covered by at least one scenario (for coverage asserts). */
export function scenarioOperationCoverage(): Set<string> {
  return new Set(SHADOW_SCENARIOS.map(s => s.op))
}
