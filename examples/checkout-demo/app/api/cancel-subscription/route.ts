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

    const cancelledSubscription = await solvaPay.apiClient.cancelSubscription({
      subscriptionRef,
      reason,
    });
    
    // Clear subscription cache to ensure fresh data on next check
    clearSubscriptionCache(userId);
    
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

