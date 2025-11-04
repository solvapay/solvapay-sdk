import { NextRequest, NextResponse } from 'next/server';
import { processPayment } from '@solvapay/next';

/**
 * Process Payment API Route
 * 
 * Processes a confirmed payment intent and creates the subscription immediately.
 * 
 * Flow:
 * 1. Client calls this API with paymentIntentId after confirming payment
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route uses the SDK helper which:
 *    - Syncs customer with SolvaPay backend
 *    - Processes the payment intent
 *    - Clears subscription cache
 * 4. Returns the payment result
 */
export async function POST(request: NextRequest) {
  const { paymentIntentId, agentRef, planRef } = await request.json();
  
  if (!paymentIntentId || !agentRef) {
    return NextResponse.json(
      { error: 'paymentIntentId and agentRef are required' },
      { status: 400 }
    );
  }
  
  const result = await processPayment(request, { paymentIntentId, agentRef, planRef });
  return result;
}

