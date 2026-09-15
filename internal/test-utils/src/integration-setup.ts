/**
 * Integration Test Setup Utilities
 *
 * These utilities help set up test fixtures for integration tests
 * against a real SolvaPay backend.
 *
 * Plan creation uses the composable pricing model: identity fields plus an
 * ordered `options[]` list. Legacy scalars (type / billingCycle / price /
 * freeUnits / pricingOptions) are authoring convenience only — translated here
 * before POST.
 */

export interface TestProviderSetup {
  providerId: string
  secretKey: string
  environment: 'sandbox' | 'live'
}

export interface TestProductSetup {
  reference: string
  name: string
  providerId: string
}

export type TestPlanPricingOption = {
  currency: string
  price: number
  basePrice?: number
  setupFee?: number
  default?: boolean
}

export interface TestPlanSetup {
  reference: string
  productRef: string
  freeUnits: number
  type: string
  price: number
  creditsPerUnit?: number
  currency: string
  pricingOptions?: TestPlanPricingOption[]
}

/** A composable pricing option in wire form (money as integer minor units). */
type WireOption = Record<string, unknown>

const USAGE_METER = 'requests'

const BILLING_CYCLE_BY_CYCLE: Record<string, WireOption> = {
  weekly: { kind: 'billingCycle', interval: 'week' },
  monthly: { kind: 'billingCycle', interval: 'month' },
  quarterly: { kind: 'billingCycle', interval: 'month', count: 3 },
  yearly: { kind: 'billingCycle', interval: 'year' },
  custom: { kind: 'billingCycle', interval: 'month' },
}

/**
 * Create a test provider and secret key via backend API
 *
 * Note: This requires the backend to expose provider management endpoints.
 * If not available, you must manually create a provider and use its secret key.
 *
 * @param apiBaseUrl - Backend URL
 * @param adminKey - Admin API key (if backend supports it)
 */
export async function createTestProvider(
  apiBaseUrl: string,
  adminKey?: string,
): Promise<TestProviderSetup> {
  void apiBaseUrl
  void adminKey
  throw new Error(
    'Provider creation via API not yet implemented. ' +
      'Please create a test provider manually and provide SOLVAPAY_SECRET_KEY. ' +
      'See packages/test-utils/README.md for setup instructions.',
  )
}

/**
 * Create a test product via SDK API
 */
export async function createTestProduct(
  apiBaseUrl: string,
  secretKey: string,
  name?: string,
): Promise<TestProductSetup> {
  const productName = name || `SDK Test Product ${Date.now()}`

  const response = await fetch(`${apiBaseUrl}/v1/sdk/products`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: productName,
      description: 'Temporary product for SDK integration tests',
      categories: ['test'],
      capabilities: { test: true },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create test product: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return {
    reference: data.data?.reference || data.reference,
    name: data.data?.name || data.name,
    providerId: data.data?.providerId || data.providerId,
  }
}

export interface CreateTestPlanOptions {
  name?: string
  type?: 'recurring' | 'usage-based' | 'one-time' | 'hybrid'
  price?: number
  currency?: string
  pricingOptions?: TestPlanPricingOption[]
  billingCycle?: string
  freeUnits?: number
  limit?: number
  creditsPerUnit?: number
  /** Auto-assign only when the plan is free. Paid + `true` throws. */
  isDefault?: boolean
}

function resolvePlanCurrency(opts: CreateTestPlanOptions): string {
  return (
    opts.currency ??
    opts.pricingOptions?.find(o => o.default)?.currency ??
    opts.pricingOptions?.[0]?.currency ??
    'USD'
  )
}

/**
 * Translate the declarative plan DSL into composable `options[]`.
 *
 * Mirrors platform QA `buildPlanOptions` / domain `legacyPlanToOptions`:
 *   recurring   -> billingCycle + flat charge (amount 0 = free)
 *   one-time    -> flat charge, no billingCycle
 *   usage-based -> per-unit charge on `requests` (+ included-unit limit)
 *   hybrid      -> billingCycle + flat base + per-unit (+ limit)
 *
 * A recurring plan authored with freeUnits > 0 (the old free-tier fixture shape)
 * is expressed as a pure-metered usage plan so the included allowance is
 * enforceable — composable recurring plans have no freeUnits scalar, and a
 * limit option requires a metered charge (R-style meter coherence).
 */
export function buildTestPlanOptions(opts: CreateTestPlanOptions): WireOption[] {
  const freeUnits = opts.freeUnits ?? 5
  const price = opts.price ?? 0
  let planType = opts.type ?? 'recurring'

  // Old free-tier fixture: recurring + freeUnits, no paid price → metered trial.
  if (planType === 'recurring' && freeUnits > 0 && price === 0 && !opts.pricingOptions?.length) {
    planType = 'usage-based'
  }

  const currency = resolvePlanCurrency(opts)
  const wireCurrency = currency.toLowerCase()
  const options: WireOption[] = []

  const recurring = planType === 'recurring' || planType === 'hybrid'
  if (recurring) {
    options.push(
      BILLING_CYCLE_BY_CYCLE[opts.billingCycle ?? 'monthly'] ?? BILLING_CYCLE_BY_CYCLE.monthly,
    )
  }

  if (planType === 'recurring' || planType === 'one-time') {
    const amountMinor =
      opts.price ??
      opts.pricingOptions?.find(o => o.default)?.price ??
      opts.pricingOptions?.[0]?.price ??
      0
    options.push({ kind: 'charge', per: 'flat', amountMinor, currency: wireCurrency })
  } else if (planType === 'hybrid') {
    options.push({
      kind: 'charge',
      per: 'flat',
      amountMinor: opts.price ?? 0,
      currency: wireCurrency,
    })
  }

  if (planType === 'usage-based' || planType === 'hybrid') {
    // `creditsPerUnit` here is the wire per-unit charge in minor units
    // (1 = 1¢ = 100 credits). Pure-metered trials omit a positive rate.
    const amountMinor = opts.creditsPerUnit ?? 0
    options.push({
      kind: 'charge',
      per: 'unit',
      amountMinor,
      currency: wireCurrency,
      meter: USAGE_METER,
    })
    const cap = opts.limit ?? opts.freeUnits
    if (cap != null && cap > 0) {
      options.push({
        kind: 'limit',
        cap,
        scope: 'billing_period',
        meter: USAGE_METER,
        onExceed: amountMinor > 0 ? 'charge' : 'block',
      })
    }
  }

  const charges =
    planType === 'hybrid' ||
    (planType === 'usage-based' && (opts.creditsPerUnit ?? 0) > 0) ||
    ((planType === 'recurring' || planType === 'one-time') &&
      (opts.price ??
        opts.pricingOptions?.find(o => o.default)?.price ??
        opts.pricingOptions?.[0]?.price ??
        0) > 0)

  if (opts.isDefault === true && charges) {
    throw new Error(
      'Only free plans can be auto-assigned — a plan that charges per unit or has a positive price requires explicit customer activation',
    )
  }

  if (!charges && (opts.isDefault ?? true)) {
    options.push({ kind: 'autoAssigned' })
  }

  return options
}

/**
 * Create a test plan via SDK API.
 * Defaults to a free metered plan with an included-unit allowance when only
 * freeUnits are provided (the historical free-tier fixture).
 */
export async function createTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
  freeUnitsOrOptions: number | CreateTestPlanOptions = 5,
): Promise<TestPlanSetup> {
  const opts: CreateTestPlanOptions =
    typeof freeUnitsOrOptions === 'number' ? { freeUnits: freeUnitsOrOptions } : freeUnitsOrOptions

  const freeUnits = opts.freeUnits ?? 5
  const price = opts.price ?? 0
  const currency = resolvePlanCurrency(opts)
  let planType = opts.type ?? 'recurring'
  if (planType === 'recurring' && freeUnits > 0 && price === 0 && !opts.pricingOptions?.length) {
    planType = 'usage-based'
  }

  const body: Record<string, unknown> = {
    name: opts.name ?? `SDK Test Plan ${Date.now()}`,
    currency,
    options: buildTestPlanOptions(opts),
    metadata: { tier: 'test' },
  }

  const response = await fetch(`${apiBaseUrl}/v1/sdk/products/${productRef}/plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create test plan: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return {
    reference: data.data?.reference || data.reference,
    productRef,
    freeUnits,
    type: data.data?.type || data.type || planType,
    price,
    creditsPerUnit: opts.creditsPerUnit,
    currency,
    pricingOptions: opts.pricingOptions,
  }
}

/**
 * Create a paid recurring plan. Multi-currency `pricingOptions` are collapsed
 * to the default (composable pricings are single-currency).
 */
export async function createMultiCurrencyPaidTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
  params: {
    defaultCurrency: string
    pricingOptions: TestPlanPricingOption[]
    name?: string
  },
): Promise<TestPlanSetup> {
  const defaultOption =
    params.pricingOptions.find(option => option.default) ?? params.pricingOptions[0]

  if (!defaultOption) {
    throw new Error('pricingOptions must include at least one currency option')
  }

  return createTestPlan(apiBaseUrl, secretKey, productRef, {
    name: params.name ?? `SDK Multi-Currency Plan ${Date.now()}`,
    type: 'recurring',
    price: defaultOption.price,
    currency: defaultOption.currency,
    billingCycle: 'monthly',
    freeUnits: 0,
    isDefault: false,
  })
}

/**
 * Create a paid recurring test plan.
 */
export async function createPaidTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
  price: number = 1999,
): Promise<TestPlanSetup> {
  return createTestPlan(apiBaseUrl, secretKey, productRef, {
    type: 'recurring',
    price,
    billingCycle: 'monthly',
    freeUnits: 0,
    isDefault: false,
  })
}

/**
 * Delete a test product
 */
export async function deleteTestProduct(
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/v1/sdk/products/${productRef}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  })

  if (!response.ok && response.status !== 404) {
    const error = await response.text()
    console.warn(`Failed to delete test product: ${response.status} - ${error}`)
  }
}

/**
 * Delete a test plan
 * Note: Plans are nested under products in the API
 */
export async function deleteTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
  planRef: string,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/v1/sdk/products/${productRef}/plans/${planRef}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  })

  if (!response.ok && response.status !== 404) {
    const error = await response.text()
    console.warn(`Failed to delete test plan: ${response.status} - ${error}`)
  }
}
