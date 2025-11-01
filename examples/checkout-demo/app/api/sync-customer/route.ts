import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';
import { SolvaPayError } from '@solvapay/core';

/**
 * Request deduplication: Track in-flight requests per userId to prevent race conditions
 * When multiple requests come in for the same userId simultaneously, they'll share the same promise
 */
const inFlightRequests = new Map<string, Promise<string>>();

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

    // Atomic check-and-set pattern to prevent race conditions
    // Double-check locking: check once, create promise, check again, use existing if found
    let syncPromise = inFlightRequests.get(userId);
    
    if (!syncPromise) {
      // Create new promise for this userId
      const newPromise = (async () => {
        try {
          // SECURITY: Only use the secret key on the server
          // Config is automatically read from environment variables
          const solvaPay = createSolvaPay();

          // Use userId as both customerRef and externalRef
          // This ensures consistent lookup and prevents duplicate customers
          // Pass email and name to ensure correct customer data
          const customerRef = await solvaPay.ensureCustomer(userId, userId, {
            email: email || undefined,
            name: name || undefined,
          });
          
          return customerRef;
        } finally {
          // Clean up the in-flight request after completion
          inFlightRequests.delete(userId);
        }
      })();
      
      // Store the promise atomically - if another request stored one while we were creating, use theirs
      const existingPromise = inFlightRequests.get(userId);
      if (existingPromise) {
        syncPromise = existingPromise;
      } else {
        inFlightRequests.set(userId, newPromise);
        syncPromise = newPromise;
      }
    }

    try {
      // Wait for the customer sync (either the new one or existing concurrent request)
      const customerRef = await syncPromise;
      
      return NextResponse.json({
        customerRef,
        success: true,
      });
    } catch (error) {
      console.error('Failed to sync customer:', error);
      
      // Handle SolvaPay configuration errors
      if (error instanceof SolvaPayError) {
        return NextResponse.json(
          { error: (error as SolvaPayError).message },
          { status: 500 }
        );
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      return NextResponse.json(
        { error: 'Failed to sync customer', details: errorMessage },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Sync customer failed:', error);
    
    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: (error as SolvaPayError).message },
        { status: 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to sync customer', details: errorMessage },
      { status: 500 }
    );
  }
}

