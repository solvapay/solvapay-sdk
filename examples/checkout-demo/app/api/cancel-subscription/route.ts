import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId } from '@solvapay/auth';
import { SolvaPayError } from '@solvapay/core';

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

    // Access the API client directly to call cancel subscription endpoint
    // The cancel subscription endpoint is: POST /v1/sdk/subscriptions/{subscriptionRef}/cancel
    const base = process.env.SOLVAPAY_API_BASE_URL || 'https://api-dev.solvapay.com';
    const apiKey = process.env.SOLVAPAY_SECRET_KEY;
    
    if (!apiKey) {
      throw new SolvaPayError('SOLVAPAY_SECRET_KEY is not configured');
    }

    const url = `${base}/v1/sdk/subscriptions/${subscriptionRef}/cancel`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    const body = reason ? { reason } : {};

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      
      if (res.status === 404) {
        return NextResponse.json(
          { error: 'Subscription not found' },
          { status: 404 }
        );
      }
      
      if (res.status === 400) {
        return NextResponse.json(
          { error: 'Subscription cannot be cancelled or does not belong to provider' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Failed to cancel subscription: ${error}` },
        { status: res.status }
      );
    }

    const cancelledSubscription = await res.json();
    
    return NextResponse.json(cancelledSubscription);

  } catch (error) {
    console.error('Cancel subscription failed:', error);
    
    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: (error as SolvaPayError).message },
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

