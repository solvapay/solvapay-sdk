import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';

/**
 * Check Subscription API Route
 * 
 * Retrieves customer subscription information from SolvaPay.
 * Returns customer details with their active subscriptions.
 * 
 * Flow:
 * 1. Client calls this API with customerRef query parameter
 * 2. This route calls SolvaPay SDK to get customer details
 * 3. Returns customer info with subscriptions array
 * 4. If customer doesn't exist, returns empty subscriptions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const customerRef = searchParams.get('customerRef');

    if (!customerRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: customerRef' },
        { status: 400 }
      );
    }

    // SECURITY: Only use the secret key on the server
    const solvapaySecretKey = process.env.SOLVAPAY_SECRET_KEY;
    const solvapayApiBaseUrl = process.env.SOLVAPAY_API_BASE_URL;

    if (!solvapaySecretKey) {
      console.error('Missing SOLVAPAY_SECRET_KEY environment variable');
      return NextResponse.json(
        { error: 'Server configuration error: SolvaPay secret key not configured' },
        { status: 500 }
      );
    }

    // Create SolvaPay instance
    const solvaPay = createSolvaPay({
      apiKey: solvapaySecretKey,
      apiBaseUrl: solvapayApiBaseUrl,
    });

    try {
      // Get customer details including subscriptions
      const customer = await solvaPay.getCustomer({ customerRef });

      // Return customer data with subscriptions
      // The API returns subscriptions array with {reference, planName, agentName, status, startDate}
      const response = {
        customerRef: customer.customerRef || customerRef,
        email: customer.email,
        name: customer.name,
        subscriptions: customer.subscriptions || [],
      };
      
      return NextResponse.json(response);

    } catch (error) {
      // Customer doesn't exist yet - return empty subscriptions (free tier)
      return NextResponse.json({
        customerRef,
        subscriptions: [],
      });
    }

  } catch (error) {
    console.error('Check subscription failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to check subscription', details: errorMessage },
      { status: 500 }
    );
  }
}

