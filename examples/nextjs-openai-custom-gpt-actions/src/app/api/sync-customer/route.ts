import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

/**
 * Sync Customer API Route
 * 
 * Ensures a customer exists in SolvaPay backend when user signs up or signs in.
 * This is called automatically after authentication to sync the user with SolvaPay.
 * 
 * Flow:
 * 1. Client calls this API route after signup/signin with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route ensures customer exists in SolvaPay backend
 * 5. Returns success status
 */
export async function POST(request: NextRequest) {
  try {
    // Get userId from middleware (set by middleware.ts)
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    // Get user email and name from Supabase JWT token
    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    // SECURITY: Only use the secret key on the server
    const solvaPay = createSolvaPay();

    // Use userId as cache key and externalRef (Supabase user IDs are stable UUIDs)
    // The first parameter (customerRef) is used as a cache key
    // The second parameter (externalRef) is stored on the SolvaPay backend for customer lookup
    // Get or create customer using ensureCustomer with externalRef for consistent lookup
    // Pass email and name to ensure correct customer data
    // The returned customerRef is the SolvaPay backend customer reference (different from Supabase user ID)
    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    return NextResponse.json({
      success: true,
      customerRef: ensuredCustomerRef,
    });

  } catch (error) {
    console.error('Customer sync failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Customer sync failed', details: errorMessage },
      { status: 500 }
    );
  }
}

