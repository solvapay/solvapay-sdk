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
 * Secure Backend API Route for Creating Checkout Sessions
 * 
 * This route generates a secure checkout session for accessing the hosted checkout page on app.solvapay.com.
 * This replaces the embedded checkout flow (create-payment-intent) with a hosted checkout flow.
 * 
 * Flow:
 * 1. Client calls this API route from browser with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route ensures customer exists in SolvaPay backend
 * 5. This route calls SolvaPay backend API to create checkout session
 * 6. Returns session details (checkoutSessionId and checkoutUrl) to client
 * 7. Client redirects to the checkoutUrl returned by the backend
 * 
 * Similar to Stripe Checkout hosted pages - the session ID is used to access
 * the hosted checkout page, allowing secure access without exposing payment details.
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
    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const { planRef, agentRef } = await request.json();

    if (!agentRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: agentRef is required' },
        { status: 400 }
      );
    }

    // SECURITY: Only use the secret key on the server
    // Config is automatically read from environment variables
    const solvaPay = createSolvaPay();

    // Use userId as customerRef (Supabase user IDs are stable UUIDs)
    // Get or create customer using ensureCustomer with externalRef for consistent lookup
    // Pass email and name to ensure correct customer data
    // Note: Customer lookup deduplication is handled automatically by the SDK
    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    // Call backend API to create checkout session using the client
    // Backend endpoint: POST /v1/sdk/checkout-sessions
    if (!solvaPay.apiClient.createCheckoutSession) {
      throw new SolvaPayError('createCheckoutSession method not available on client');
    }

    const session = await solvaPay.apiClient.createCheckoutSession({
      agentRef,
      customerRef: ensuredCustomerRef,
      planRef: planRef || undefined,
    });

    // Return the session details to the client
    // The backend returns checkoutSessionId and checkoutUrl
    return NextResponse.json({
      checkoutSessionId: session.checkoutSessionId,
      checkoutUrl: session.checkoutUrl,
    });

  } catch (error) {
    console.error('Checkout session creation failed:', error);
    
    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: (error as SolvaPayError).message },
        { status: 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Checkout session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}

