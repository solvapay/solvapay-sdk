import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';
import { SolvaPayError } from '@solvapay/core';
// Note: Middleware handles authentication and sets x-user-id header
// Alternative approach: Use SupabaseAuthAdapter directly in route:
// import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
// const auth = new SupabaseAuthAdapter({ jwtSecret: process.env.SUPABASE_JWT_SECRET! });
// const userId = await auth.getUserIdFromRequest(request);

/**
 * Check Subscription API Route
 * 
 * Retrieves customer subscription information from SolvaPay.
 * Returns customer details with their active subscriptions.
 * 
 * Flow:
 * 1. Client calls this API with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route calls SolvaPay SDK to get customer details
 * 5. Returns customer info with subscriptions array
 * 6. If customer doesn't exist, returns empty subscriptions
 */

export async function GET(request: NextRequest) {
  try {
    // Get userId from middleware (set by middleware.ts)
    // Middleware handles authentication and returns 401 if not authenticated
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    // Get user email and name from Supabase JWT token
    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    // SECURITY: Only use the secret key on the server
    // Config is automatically read from environment variables
    const solvaPay = createSolvaPay();

    try {
      // Use userId as customerRef (Supabase user IDs are stable UUIDs)
      // Ensure customer exists and get backend customer reference using externalRef
      // Pass email and name to ensure correct customer data
      const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
        email: email || undefined,
        name: name || undefined,
      });
      
      // Get customer details including subscriptions using the backend customer reference
      const customer = await solvaPay.getCustomer({ customerRef: ensuredCustomerRef });

      // Return customer data with subscriptions
      // The API returns subscriptions array with {reference, planName, agentName, status, startDate}
      const response = {
        customerRef: customer.customerRef || userId,
        email: customer.email,
        name: customer.name,
        subscriptions: customer.subscriptions || [],
      };
      
      return NextResponse.json(response);

    } catch (error) {
      // Customer doesn't exist yet - return empty subscriptions (free tier)
      return NextResponse.json({
        customerRef: userId,
        subscriptions: [],
      });
    }

  } catch (error) {
    console.error('Check subscription failed:', error);
    
    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: (error as SolvaPayError).message },
        { status: 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to check subscription', details: errorMessage },
      { status: 500 }
    );
  }
}

