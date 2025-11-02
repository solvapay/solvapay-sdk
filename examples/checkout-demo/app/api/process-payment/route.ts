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
    const customerRef = await solvaPay.ensureCustomer(userId, userId);
    
    // Call SDK method to process the already-confirmed payment
    // Backend automatically handles provider account context based on API key
    const result = await solvaPay.processPayment({
      paymentIntentId,
      agentRef,
      customerRef,
      planRef,
    });
    
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

