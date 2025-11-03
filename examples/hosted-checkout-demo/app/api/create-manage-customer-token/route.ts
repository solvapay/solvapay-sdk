import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';
import { SolvaPayError } from '@solvapay/core';
// Note: Middleware handles authentication and sets x-user-id header
// Alternative approach: Use SupabaseAuthAdapter directly in route:
// import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
// const auth = new SupabaseAuthAdapter({ jwtSecret: process.env.SUPABASE_JWT_SECRET! });
// const userId = await auth.getUserIdFromRequest(request);

/**
 * Secure Backend API Route for Creating Customer Management Tokens
 * 
 * This route generates a secure token for accessing the hosted customer management page on app.solvapay.com.
 * This enables users to manage their subscriptions, billing, and payment methods on a hosted page.
 * 
 * Flow:
 * 1. Client calls this API route from browser with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route ensures customer exists in SolvaPay backend
 * 5. This route calls SolvaPay backend API to create customer management token
 * 6. Returns token to client
 * 7. Client redirects to app.solvapay.com/customer?token=<token>
 * 
 * Similar to Stripe Customer Portal - the token is appended as a query parameter
 * to the hosted customer management URL, allowing secure access for subscription management.
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

    // Get user email and name from Supabase JWT token
    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    // SECURITY: Only use the secret key on the server
    // Config is automatically read from environment variables
    const solvaPay = createSolvaPay();

    // Use userId as customerRef (Supabase user IDs are stable UUIDs)
    // Get or create customer using ensureCustomer with externalRef for consistent lookup
    // Pass email and name to ensure correct customer data
    // Note: Customer lookup deduplication is handled automatically by the SDK
    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    // Call backend API to create customer management token
    // Expected backend endpoint: POST /api/create-manage-customer-token
    // This endpoint should be implemented on the SolvaPay backend
    const apiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'https://api-dev.solvapay.com';
    const apiKey = process.env.SOLVAPAY_SECRET_KEY;

    if (!apiKey) {
      throw new SolvaPayError('Missing SOLVAPAY_SECRET_KEY environment variable');
    }

    const requestBody = {
      customerRef: ensuredCustomerRef,
    };

    const backendResponse = await fetch(`${apiBaseUrl}/api/create-manage-customer-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      const errorMessage = errorData.error || errorData.message || 'Failed to create customer management token';
      console.error('Backend customer management token creation failed:', errorMessage, errorData);
      throw new Error(errorMessage);
    }

    const { token } = await backendResponse.json();

    if (!token) {
      throw new Error('Backend did not return a token');
    }

    // Return the token to the client
    // The client will append this token as a query parameter to the hosted customer management URL
    return NextResponse.json({
      token,
      customerUrl: `https://app.solvapay.com/customer?token=${token}`,
    });

  } catch (error) {
    console.error('Customer management token creation failed:', error);
    
    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: (error as SolvaPayError).message },
        { status: 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Customer management token creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}

