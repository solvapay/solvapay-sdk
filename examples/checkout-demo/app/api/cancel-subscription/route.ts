import { NextRequest, NextResponse } from 'next/server';
import { cancelSubscription } from '@solvapay/next';

/**
 * Cancel Subscription API Route
 * 
 * Cancels an active subscription for the authenticated user.
 * 
 * Flow:
 * 1. Client calls this API with Authorization header and subscriptionRef
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route uses the SDK helper which:
 *    - Validates the subscription can be cancelled
 *    - Cancels the subscription
 *    - Clears subscription cache
 * 4. Returns the cancelled subscription details
 */
export async function POST(request: NextRequest) {
  const { subscriptionRef, reason } = await request.json();

  if (!subscriptionRef) {
    return NextResponse.json(
      { error: 'Missing required parameter: subscriptionRef is required' },
      { status: 400 }
    );
  }

  const result = await cancelSubscription(request, { subscriptionRef, reason });
  return result;
}

