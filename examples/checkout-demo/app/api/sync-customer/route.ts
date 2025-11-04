import { NextRequest, NextResponse } from 'next/server';
import { syncCustomer } from '@solvapay/next';

/**
 * Sync Customer API Route
 * 
 * Ensures a customer exists in SolvaPay backend using externalRef.
 * This route is idempotent and safe to call multiple times.
 * 
 * Flow:
 * 1. Client calls this API with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route uses the SDK helper which:
 *    - Reads userId from x-user-id header
 *    - Gets user email and name from Supabase JWT token
 *    - Calls SolvaPay SDK to ensure customer exists (with built-in deduplication)
 *    - Returns customer reference
 * 
 * Can be called:
 * - On user signup (eager creation)
 * - On user login (ensure customer exists)
 * - Before payment operations (lazy creation)
 * 
 * Note: Customer lookup deduplication is handled automatically by the SDK
 */
export async function POST(request: NextRequest) {
  const customerRef = await syncCustomer(request);
  
  if (customerRef instanceof NextResponse) {
    return customerRef;
  }
  
  return NextResponse.json({
    customerRef,
    success: true,
  });
}

