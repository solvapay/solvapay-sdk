/**
 * Integration Test Setup Utilities
 *
 * These utilities help set up test fixtures for integration tests
 * against a real SolvaPay backend.
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

export interface TestPlanSetup {
  reference: string
  productRef: string
  freeUnits: number
  type: string
  price: number
  pricePerUnit?: number
  currency: string
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
  // TODO: Implement when backend exposes provider creation API
  // For now, this documents the expected behavior

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
  type?: 'recurring' | 'usage-based' | 'one-time' | 'hybrid'
  price?: number
  currency?: string
  billingCycle?: string
  freeUnits?: number
  limit?: number
  pricePerUnit?: number
  isDefault?: boolean
}

/**
 * Create a test plan via SDK API.
 * Defaults to a free recurring plan if no options are provided.
 */
export async function createTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  productRef: string,
  freeUnitsOrOptions: number | CreateTestPlanOptions = 5,
): Promise<TestPlanSetup> {
  const opts: CreateTestPlanOptions =
    typeof freeUnitsOrOptions === 'number'
      ? { freeUnits: freeUnitsOrOptions }
      : freeUnitsOrOptions

  const planType = opts.type ?? 'recurring'
  const price = opts.price ?? 0
  const freeUnits = opts.freeUnits ?? 5
  const currency = opts.currency ?? 'USD'

  const body: Record<string, unknown> = {
    type: planType,
    price,
    currency,
    default: opts.isDefault ?? true,
    freeUnits,
    limit: opts.limit ?? freeUnits,
    metadata: { tier: 'test' },
  }

  if (planType === 'recurring' || planType === 'hybrid') {
    body.billingCycle = opts.billingCycle ?? 'monthly'
  }

  if (planType === 'usage-based') {
    body.billingModel = 'pre-paid'
    body.pricePerUnit = opts.pricePerUnit ?? 0
  }

  if (planType === 'hybrid') {
    body.pricePerUnit = opts.pricePerUnit ?? 0
    body.basePrice = price
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
    type: planType,
    price,
    pricePerUnit: opts.pricePerUnit,
    currency,
  }
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
