import { NextRequest } from 'next/server';
import { listPlans } from '@solvapay/next';

/**
 * List Plans API Route
 * 
 * Retrieves available subscription plans from SolvaPay.
 * Returns all plans for the configured agent.
 * 
 * Flow:
 * 1. Client calls this API with agentRef query parameter
 * 2. This route uses the SDK helper to get list of plans
 * 3. Returns plans array with details
 */
export async function GET(request: NextRequest) {
  const result = await listPlans(request);
  return result;
}

