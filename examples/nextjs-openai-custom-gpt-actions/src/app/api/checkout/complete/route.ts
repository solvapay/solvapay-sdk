import { NextRequest, NextResponse } from 'next/server';
import { updateUserPlan } from '@/services/userPlanService';
import { ensureCustomerRef } from '@/../../packages/server/src/paywall';

/**
 * Checkout Complete Endpoint
 * 
 * Handles checkout completion and updates user plan.
 * Uses Supabase user ID from middleware (set by SupabaseAuthAdapter).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const plan = url.searchParams.get('plan');
  const returnUrl = url.searchParams.get('return_url');

  console.log('🔍 [CHECKOUT COMPLETE] Parameters:', { plan, returnUrl });
  console.log('🔍 [CHECKOUT COMPLETE] Headers:', Object.fromEntries(request.headers.entries()));

  // Validate required parameters
  if (!plan) {
    console.error('❌ [CHECKOUT COMPLETE] Missing required parameter: plan');
    return NextResponse.json({ error: 'Missing required parameter: plan' }, { status: 400 });
  }

  // Get user ID from middleware (Supabase auth)
  let userId: string | null = request.headers.get('x-user-id');

  // Fallback: try OAuth token if middleware didn't set user ID
  if (!userId) {
    let authHeader = request.headers.get('authorization');
    if (!authHeader) {
      const scHeadersRaw = request.headers.get('x-vercel-sc-headers');
      if (scHeadersRaw) {
        try {
          const scHeaders = JSON.parse(scHeadersRaw);
          const scAuth = scHeaders.Authorization || scHeaders.authorization;
          if (typeof scAuth === 'string') {
            authHeader = scAuth;
            console.log('🔍 [CHECKOUT COMPLETE] Found Authorization in x-vercel-sc-headers');
          }
        } catch (e) {
          console.log('🔍 [CHECKOUT COMPLETE] Failed to parse x-vercel-sc-headers:', e);
        }
      }
    }
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const { decodeJwt, jwtVerify } = await import('jose');
        const decoded = decodeJwt(token);
        const issuer = decoded.iss as string | undefined;
        if (issuer === process.env.OAUTH_ISSUER) {
          const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
          const { payload } = await jwtVerify(token, jwtSecret, {
            issuer: process.env.OAUTH_ISSUER!
          });
          userId = (payload as any).customer_ref as string || (payload.sub as string);
          console.log('🔍 [CHECKOUT COMPLETE] Found OAuth user ID:', userId);
        } else {
          // Ignore non-OAuth internal tokens (e.g., Vercel suspense-cache)
          console.log('🔍 [CHECKOUT COMPLETE] Ignoring non-OAuth Authorization token with issuer:', issuer);
        }
      } catch (error) {
        console.log('🔍 [CHECKOUT COMPLETE] Ignoring Authorization header (not a valid OAuth token).');
      }
    }
  }

  // Fallback: allow demo flow using x-customer-ref header or query param when Authorization is missing
  if (!userId) {
    const headerCustomerRef = request.headers.get('x-customer-ref');
    const queryCustomerRef = url.searchParams.get('customer_ref');
    const fallbackUserId = headerCustomerRef || queryCustomerRef;
    if (fallbackUserId) {
      console.warn('⚠️ [CHECKOUT COMPLETE] Using fallback customer ref (no OAuth):', fallbackUserId);
      userId = fallbackUserId;
    } else {
      console.error('❌ [CHECKOUT COMPLETE] No OAuth authentication or customer ref found');
      return NextResponse.json({ 
        error: 'Authentication required', 
        error_description: 'OAuth token or customer_ref required for checkout completion' 
      }, { status: 401 });
    }
  }

  // Normalize to customer_ref format used across SDK
  const normalizedUserId = ensureCustomerRef(userId);
  console.log('🔍 [CHECKOUT COMPLETE] Using user ID:', userId, '→ normalized:', normalizedUserId);

  // Update user plan directly using the service
  try {
    console.log('🔍 [CHECKOUT COMPLETE] Updating user plan:', { userId: normalizedUserId, plan });
    const updatedPlan = await updateUserPlan(normalizedUserId, plan);
    console.log('✅ [CHECKOUT COMPLETE] User plan updated successfully:', { userId: normalizedUserId, ...updatedPlan });
    
    // Verify the plan was saved by loading it back
    const { loadUserPlans } = await import('@/lib/storage-adapter');
    const savedPlans = await loadUserPlans();
    console.log('🔍 [CHECKOUT COMPLETE] Verification - saved plans:', savedPlans);
  } catch (error) {
    console.error('❌ [CHECKOUT COMPLETE] Failed to update user plan:', error);
  }

  // Redirect to the completion page with the plan information
  const completionUrl = `/checkout/complete?plan=${encodeURIComponent(plan)}${returnUrl ? `&return_url=${encodeURIComponent(returnUrl)}` : ''}`;
  
  return NextResponse.redirect(new URL(completionUrl, request.url));
}
