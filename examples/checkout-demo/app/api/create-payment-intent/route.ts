import { NextRequest, NextResponse } from 'next/server';
import { createPaymentIntent } from '@solvapay/next';

/**
 * Secure Backend API Route for Creating Payment Intents
 * 
 * This route handles payment intent creation using the SolvaPay server SDK.
 * It runs on the server with the secret key, keeping it secure from the browser.
 * 
 * Flow:
 * 1. Client calls this API route from browser with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route uses the SDK helper which:
 *    - Reads userId from x-user-id header
 *    - Gets user email and name from Supabase JWT token
 *    - Syncs customer with SolvaPay backend
 *    - Creates payment intent with Stripe
 *    - Clears subscription cache
 * 4. Returns clientSecret and publishableKey to client
 * 5. Client initializes Stripe Elements with these values
 */
export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();

  if (!planRef || !agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameters: planRef and agentRef are required' },
      { status: 400 }
    );
  }

  const result = await createPaymentIntent(request, { planRef, agentRef });
  return result;
}

