import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription, type SubscriptionCheckResult } from '@solvapay/next';

/**
 * Check Subscription API Route
 * 
 * Retrieves customer subscription information from SolvaPay.
 * Returns customer details with their active subscriptions.
 * 
 * Flow:
 * 1. Client calls this API with Authorization header
 * 2. Middleware extracts userId from Supabase JWT token and sets x-user-id header
 * 3. This route uses the SDK helper which:
 *    - Reads userId from x-user-id header
 *    - Gets user email and name from Supabase JWT token
 *    - Calls SolvaPay SDK to get customer details (with built-in deduplication)
 *    - Returns customer info with subscriptions array
 * 4. If customer doesn't exist, returns empty subscriptions
 * 
 * Note: Request deduplication is handled automatically by the SDK:
 * - Deduplicates concurrent requests (multiple requests share the same promise)
 * - Caches results for 2 seconds (prevents duplicate sequential requests)
 * - Automatic cleanup of expired cache entries
 * - Memory-safe with max cache size
 * 
 * This is a simple in-memory cache suitable for single-instance deployments.
 * For multi-instance deployments, consider using Redis or a shared cache.
 */
export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  // If result is a NextResponse, it's an error response - return it
  if (result instanceof NextResponse) {
    return result;
  }
  
  // TypeScript now knows result is SubscriptionCheckResult after the instanceof check
  // Cast to SubscriptionCheckResult to help TypeScript understand the type
  const subscriptionData = result as SubscriptionCheckResult;
  
  return NextResponse.json(subscriptionData);
}

