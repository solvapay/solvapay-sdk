import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId } from '@solvapay/auth';
import { SolvaPayError } from '@solvapay/core';
import { clearSubscriptionCache } from '@solvapay/next';

/**
 * Cancel Subscription API Route
 * 
 * Cancels an active subscription for the authenticated user.
 * 
 * Flow:
 * 1. Client calls this API with Authorization header and subscriptionRef
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route calls SolvaPay SDK to cancel the subscription
 * 5. Returns the cancelled subscription details
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

    const { subscriptionRef, reason } = await request.json();

    if (!subscriptionRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: subscriptionRef is required' },
        { status: 400 }
      );
    }

    // SECURITY: Only use the secret key on the server
    // Config is automatically read from environment variables
    const solvaPay = createSolvaPay();

    // Use the SDK client to cancel the subscription
    if (!solvaPay.apiClient.cancelSubscription) {
      throw new SolvaPayError('Cancel subscription method not available on SDK client');
    }


    let cancelledSubscription = await solvaPay.apiClient.cancelSubscription({
      subscriptionRef,
      reason,
    });
    
    // Validate response (client should already extract subscription from nested response)
    if (!cancelledSubscription || typeof cancelledSubscription !== 'object') {
      throw new SolvaPayError('Invalid response from cancel subscription endpoint');
    }
    
    // Fallback: Extract subscription from nested response if client didn't already do it
    // This handles cases where the backend returns { subscription: {...}, message: "..." }
    const responseAny = cancelledSubscription as any;
    if (responseAny.subscription && typeof responseAny.subscription === 'object') {
      cancelledSubscription = responseAny.subscription;
    }
    
    // Validate required fields
    if (!cancelledSubscription.reference) {
      throw new SolvaPayError('Cancel subscription response missing required fields');
    }
    
    // Check if subscription was actually cancelled
    // It's expected for a subscription to be 'active' but with cancelledAt and endDate set
    // This means the subscription is cancelled but still active until the endDate
    const isCancelled = cancelledSubscription.status === 'cancelled' || cancelledSubscription.cancelledAt;
    
    if (!isCancelled) {
      throw new SolvaPayError(`Subscription cancellation failed: backend returned status '${cancelledSubscription.status}' without cancelledAt timestamp`);
    }
    
    // Clear subscription cache to ensure fresh data on next check
    clearSubscriptionCache(userId);
    
    // Add a small delay to allow backend to fully process the cancellation
    // This helps ensure that subsequent subscription checks return the updated status
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return NextResponse.json(cancelledSubscription);

  } catch (error) {
    console.error('Cancel subscription failed:', {
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    
    // Handle SolvaPay errors and map to appropriate HTTP status codes
    if (error instanceof SolvaPayError) {
      const errorMessage = error.message;
      
      // Map specific error messages to HTTP status codes
      if (errorMessage.includes('Subscription not found')) {
        return NextResponse.json(
          { error: 'Subscription not found', details: errorMessage },
          { status: 404 }
        );
      }
      
      if (errorMessage.includes('cannot be cancelled') || errorMessage.includes('does not belong to provider')) {
        return NextResponse.json(
          { error: 'Subscription cannot be cancelled or does not belong to provider', details: errorMessage },
          { status: 400 }
        );
      }
      
      // For other SolvaPay errors, return 500 with the error message
      return NextResponse.json(
        { error: errorMessage, details: errorMessage },
        { status: 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to cancel subscription', details: errorMessage },
      { status: 500 }
    );
  }
}

