import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@solvapay/auth';
import { createSolvaPay } from '@solvapay/server';
import { clearSubscriptionCache } from '@solvapay/next';

export async function POST(request: NextRequest) {
  try {
    const userId = requireUserId(request);
    if (userId instanceof Response) return userId;
    
    const { paymentIntentId, agentRef, planRef } = await request.json();
    
    if (!paymentIntentId || !agentRef) {
      return NextResponse.json(
        { error: 'paymentIntentId and agentRef are required' },
        { status: 400 }
      );
    }
    
    const solvaPay = createSolvaPay();
    
    // SECURITY: Always use userId from JWT token, never trust client-provided customerRef header
    // This ensures we process payment for the correct user, even if frontend cache is stale
    // The customerRef must match the userId to prevent cross-user payment processing
    const customerRef = await solvaPay.ensureCustomer(userId, userId);
    
    // Call SDK method to process the already-confirmed payment
    // Backend automatically handles provider account context based on API key
    // Note: The paymentIntent was created with a customerRef, and we verify it matches here
    const result = await solvaPay.processPayment({
      paymentIntentId,
      agentRef,
      customerRef,
      planRef,
    });
    
    // Check if we got a timeout - this means webhooks aren't configured
    // The subscription may still be created by webhook later, but we can't wait for it
    if ((result as any)?.status === 'timeout') {
      console.warn('[process-payment] Payment processing timed out waiting for webhook');
    }
    
    // Clear subscription cache to ensure fresh data on next fetch
    // This ensures the new subscription appears immediately when client refetches
    clearSubscriptionCache(userId);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Payment processing failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}

