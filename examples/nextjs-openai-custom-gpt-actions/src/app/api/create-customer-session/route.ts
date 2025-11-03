import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';
// Note: Middleware handles authentication and sets x-user-id header
// Alternative approach: Use SupabaseAuthAdapter directly in route:
// import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
// const auth = new SupabaseAuthAdapter({ jwtSecret: process.env.SUPABASE_JWT_SECRET! });
// const userId = await auth.getUserIdFromRequest(request);

/**
 * Secure Backend API Route for Creating Customer Sessions
 * 
 * This route generates a secure session for accessing customer-specific functionality.
 * 
 * Flow:
 * 1. Client calls this API route from browser with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route reads userId from x-user-id header
 * 4. This route ensures customer exists in SolvaPay backend
 * 5. This route calls SolvaPay backend API to create customer session
 * 6. Returns session details to client
 * 
 * The backend endpoint: POST /v1/sdk/customer-sessions
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

    // Call backend API to create customer session
    // Backend endpoint: POST /v1/sdk/customer-sessions
    const session = await solvaPay.createCustomerSession({
      customerRef: ensuredCustomerRef,
    });

    // Return the session data to the client
    // Expected response format: { sessionId: string, customerUrl: string }
    return NextResponse.json(session);

  } catch (error) {
    console.error('Customer session creation failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Customer session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}

