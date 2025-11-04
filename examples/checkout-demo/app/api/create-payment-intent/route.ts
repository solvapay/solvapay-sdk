import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';
import { SolvaPayError } from '@solvapay/core';
import { clearSubscriptionCache } from '@solvapay/next';
// Note: Middleware handles authentication and sets x-user-id header
// Alternative approach: Use SupabaseAuthAdapter directly in route:
// import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
// const auth = new SupabaseAuthAdapter({ jwtSecret: process.env.SUPABASE_JWT_SECRET! });
// const userId = await auth.getUserIdFromRequest(request);

/**
 * Secure Backend API Route for Creating Payment Intents
 * 
 * This route handles payment intent creation using the SolvaPay server SDK.
 * It runs on the server with the secret key, keeping it secure from the browser.
 * 
 * Flow:
 * 1. Client calls this API route from browser with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route calls SolvaPay SDK with secret key
 * 5. SolvaPay SDK creates payment intent with Stripe
 * 6. Returns clientSecret and publishableKey to client
 * 7. Client initializes Stripe Elements with these values
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

    if (!planRef || !agentRef) {
      return NextResponse.json(
        { error: 'Missing required parameters: planRef and agentRef are required' },
        { status: 400 }
      );
    }

    // SECURITY: Only use the secret key on the server
    // Config is automatically read from environment variables
    const solvaPay = createSolvaPay();

    // SECURITY: Always use userId from JWT token, never trust client-provided customerRef header
    // The frontend may send x-solvapay-customer-ref header, but we ignore it for security
    // This prevents cross-user contamination if localStorage cache is stale or malicious
    // We always derive customerRef from the authenticated userId to ensure correctness
    
    // Use userId as cache key and externalRef (Supabase user IDs are stable UUIDs)
    // The first parameter (customerRef) is used as a cache key
    // The second parameter (externalRef) is stored on the SolvaPay backend for customer lookup
    // Get or create customer using ensureCustomer with externalRef for consistent lookup
    // Pass email and name to ensure correct customer data
    // Note: Customer lookup deduplication is handled automatically by the SDK
    // The returned customerRef is the SolvaPay backend customer reference (different from Supabase user ID)
    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    // Create payment intent using the SDK
    // The SDK will call the backend which creates the payment intent
    // ensuredCustomerRef is the SolvaPay backend customer reference (not the Supabase user ID)
    const paymentIntent = await solvaPay.createPaymentIntent({
      agentRef,
      planRef,
      customerRef: ensuredCustomerRef,
    });

    // Clear subscription cache to ensure fresh data after payment intent creation
    // Payment intent creation may update subscription status
    clearSubscriptionCache(userId);

    // Return the payment intent details to the client
    // The clientSecret is safe to send to the browser (it's scoped to this payment)
    const response = {
      id: paymentIntent.id,
      clientSecret: paymentIntent.clientSecret,
      publishableKey: paymentIntent.publishableKey,
      accountId: paymentIntent.accountId,
      customerRef: ensuredCustomerRef, // Return the backend customer reference
    };
    
    return NextResponse.json(response);

  } catch (error) {
    console.error('Payment intent creation failed:', error);
    
    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: (error as SolvaPayError).message },
        { status: 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Payment intent creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}

