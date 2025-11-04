import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

/**
 * Sync Customer API Route
 * 
 * Ensures a customer exists in SolvaPay backend using externalRef.
 * This route is idempotent and safe to call multiple times.
 * 
 * Flow:
 * 1. Client calls this API with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route calls SolvaPay SDK to ensure customer exists (lookup or create)
 * 5. Returns customer reference
 * 
 * Can be called:
 * - On user signup (eager creation)
 * - On user login (ensure customer exists)
 * - Before payment operations (lazy creation)
 * 
 * Note: Customer lookup deduplication is handled automatically by the SDK
 * (sharedCustomerLookupDeduplicator prevents race conditions across concurrent requests)
 */

export async function POST(request: NextRequest) {
  try {
    // Get userId from middleware (set by middleware.ts)
    // Middleware handles authentication and returns 401 if not authenticated
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    // Get user email and name from Supabase JWT token
    // This is request-specific, but for the same user, the values should be identical
    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    // SECURITY: Only use the secret key on the server
    // Config is automatically read from environment variables
    const solvaPay = createSolvaPay();

    // Use userId as cache key (first param) and externalRef (second param)
    // The first parameter (customerRef) is used as a cache key
    // The second parameter (externalRef) is stored on the SolvaPay backend for customer lookup
    // This ensures consistent lookup and prevents duplicate customers
    // Pass email and name to ensure correct customer data
    // Note: Customer lookup deduplication is handled automatically by the SDK
    // The returned customerRef is the SolvaPay backend customer reference (different from Supabase user ID)
    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    return NextResponse.json({
      customerRef,
      success: true,
    });
  } catch (error) {
    console.error('Sync customer failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to sync customer', details: errorMessage },
      { status: 500 }
    );
  }
}

