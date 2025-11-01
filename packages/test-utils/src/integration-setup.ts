/**
 * Integration Test Setup Utilities
 * 
 * These utilities help set up test fixtures for integration tests
 * against a real SolvaPay backend.
 */

export interface TestProviderSetup {
  providerId: string;
  secretKey: string;
  environment: 'sandbox' | 'live';
}

export interface TestAgentSetup {
  reference: string;
  name: string;
  providerId: string;
}

export interface TestPlanSetup {
  reference: string;
  name: string;
  agentRef: string;
  isFreeTier: boolean;
  freeUnits: number;
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
  adminKey?: string
): Promise<TestProviderSetup> {
  // TODO: Implement when backend exposes provider creation API
  // For now, this documents the expected behavior
  
  throw new Error(
    'Provider creation via API not yet implemented. ' +
    'Please create a test provider manually and provide SOLVAPAY_SECRET_KEY. ' +
    'See packages/test-utils/README.md for setup instructions.'
  );
}

/**
 * Create a test agent via SDK API
 */
export async function createTestAgent(
  apiBaseUrl: string,
  secretKey: string,
  name?: string
): Promise<TestAgentSetup> {
  const agentName = name || `SDK Test Agent ${Date.now()}`;
  
  const response = await fetch(`${apiBaseUrl}/v1/sdk/agents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: agentName,
      description: 'Temporary agent for SDK integration tests',
      categories: ['test'],
      capabilities: { 'test': true }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create test agent: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return {
    reference: data.data?.reference || data.reference,
    name: data.data?.name || data.name,
    providerId: data.data?.providerId || data.providerId
  };
}

/**
 * Create a test plan via SDK API
 */
export async function createTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  agentRef: string,
  name?: string,
  freeUnits: number = 5
): Promise<TestPlanSetup> {
  const planName = name || `SDK Test Plan ${Date.now()}`;
  
  const response = await fetch(`${apiBaseUrl}/v1/sdk/agents/${agentRef}/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: planName,
      description: 'Temporary plan for SDK integration tests',
      type: 'usage-based',
      price: 0,
      currency: 'USD',
      billingModel: 'pre-paid',
      pricePerUnit: 0,
      unit: 'requests',
      quota: freeUnits,
      isFreeTier: true,
      freeUnits: freeUnits,
      features: [`${freeUnits} free requests`],
      limits: {
        monthlyRequests: freeUnits
      },
      metadata: {
        tier: 'test'
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create test plan: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return {
    reference: data.data?.reference || data.reference,
    name: data.data?.name || data.name,
    agentRef,
    isFreeTier: true,
    freeUnits
  };
}

/**
 * Delete a test agent
 */
export async function deleteTestAgent(
  apiBaseUrl: string,
  secretKey: string,
  agentRef: string
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/v1/sdk/agents/${agentRef}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${secretKey}`
    }
  });

  if (!response.ok && response.status !== 404) {
    const error = await response.text();
    console.warn(`Failed to delete test agent: ${response.status} - ${error}`);
  }
}

/**
 * Delete a test plan
 * Note: Plans are nested under agents in the API
 */
export async function deleteTestPlan(
  apiBaseUrl: string,
  secretKey: string,
  agentRef: string,
  planRef: string
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/v1/sdk/agents/${agentRef}/plans/${planRef}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${secretKey}`
    }
  });

  if (!response.ok && response.status !== 404) {
    const error = await response.text();
    console.warn(`Failed to delete test plan: ${response.status} - ${error}`);
  }
}

