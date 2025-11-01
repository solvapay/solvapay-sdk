import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';

/**
 * Secure Backend API Route for Creating Payment Intents
 * 
 * This route handles payment intent creation using the SolvaPay server SDK.
 * It runs on the server with the secret key, keeping it secure from the browser.
 * 
 * Flow:
 * 1. Client calls this API route from browser
 * 2. This route calls SolvaPay SDK with secret key
 * 3. SolvaPay SDK creates payment intent with Stripe
 * 4. Returns clientSecret and publishableKey to client
 * 5. Client initializes Stripe Elements with these values
 */
export async function POST(request: NextRequest) {
  try {
    const { planRef, agentRef, customerRef } = await request.json();

    // SECURITY: Only use the secret key on the server
    // The SDK handles the secure communication with Stripe
    const solvapaySecretKey = process.env.SOLVAPAY_SECRET_KEY;
    const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL;

    if (!solvapaySecretKey) {
      console.error('Missing SOLVAPAY_SECRET_KEY environment variable');
      return NextResponse.json(
        { error: 'Server configuration error: SolvaPay secret key not configured' },
        { status: 500 }
      );
    }

    if (!planRef || !agentRef || !customerRef) {
      return NextResponse.json(
        { error: 'Missing required parameters: planRef, agentRef, and customerRef are required' },
        { status: 400 }
      );
    }

    // Create SolvaPay instance
    const solvaPay = createSolvaPay({
      apiKey: solvapaySecretKey,
      apiBaseUrl: solvapayApiBaseUrl,
    });

    // Get or create customer using ensureCustomer
    const ensuredCustomerRef = await solvaPay.ensureCustomer(customerRef);

    // Create payment intent using the SDK
    // The SDK will call the backend which creates the payment intent
    const paymentIntent = await solvaPay.createPaymentIntent({
      agentRef,
      planRef,
      customerRef: ensuredCustomerRef,
    });

    // Return the payment intent details to the client
    // The clientSecret is safe to send to the browser (it's scoped to this payment)
    // IMPORTANT: Return the backend customer reference so frontend can update localStorage
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
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Payment intent creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}

