import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { ensureCustomerRef } from '@/../../packages/server/src/paywall';
import { revokedTokens } from '@/lib/oauth-storage';
import { loadUserPlans } from '@/lib/storage-adapter';

/**
 * User Plan Endpoint
 * 
 * Returns the user's plan information.
 * Supports both OAuth tokens (from OpenAI) and Supabase authentication (from middleware).
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null;

    // First, try to get user ID from middleware (Supabase auth)
    userId = request.headers.get('x-user-id');

    // If not available from middleware, try OAuth token (for OpenAI Custom GPT Actions)
    if (!userId) {
      const authHeader = request.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        // On Vercel, Authorization may be in x-vercel-sc-headers
        let tokenHeader = authHeader;
        const scHeadersRaw = request.headers.get('x-vercel-sc-headers');
        if (scHeadersRaw) {
          try {
            const scHeaders = JSON.parse(scHeadersRaw);
            const scAuth = scHeaders.Authorization || scHeaders.authorization;
            if (typeof scAuth === 'string') tokenHeader = scAuth;
          } catch {}
        }

        const token = tokenHeader.substring(7);
        
        // Check if token is revoked
        if (revokedTokens.has(token)) {
          return NextResponse.json(
            { error: 'unauthorized', error_description: 'Token has been revoked' },
            { status: 401 }
          );
        }
        
        try {
          // Verify JWT token (OAuth token)
          const { decodeJwt } = await import('jose');
          const decoded = decodeJwt(token);
          if (decoded.iss !== process.env.OAUTH_ISSUER) {
            return NextResponse.json(
              { error: 'unauthorized', error_description: 'Invalid token issuer' },
              { status: 401 }
            );
          }
          const jwtSecret = new TextEncoder().encode(process.env.OAUTH_JWKS_SECRET!);
          const { payload } = await jwtVerify(token, jwtSecret, {
            issuer: process.env.OAUTH_ISSUER!,
            audience: process.env.OAUTH_CLIENT_ID || 'test-client-id'
          });

          userId = payload.sub as string;
        } catch (error) {
          console.error('Invalid token:', error);
          return NextResponse.json(
            { error: 'unauthorized', error_description: 'Invalid access token' },
            { status: 401 }
          );
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', error_description: 'Missing or invalid access token' },
        { status: 401 }
      );
    }

    const normalizedUserId = ensureCustomerRef(userId);
    console.log('🔍 [USER PLAN] ChatGPT requesting plan for user ID:', normalizedUserId);
    const userPlans = await loadUserPlans();
    console.log('🔍 [USER PLAN] Available user plans:', userPlans);
    const userPlan = userPlans[normalizedUserId] || { plan: 'free' };
    console.log('🔍 [USER PLAN] Found user plan:', userPlan);

    // Return user plan with usage data
    return NextResponse.json({
      plan: userPlan.plan || 'free',
      usage: {
        api_calls: userPlan.plan === 'pro' ? 0 : 42, // Demo usage data
        last_reset: new Date().toISOString()
      },
      limits: {
        api_calls: userPlan.plan === 'pro' ? 999999 : 100,
        reset_period: 'monthly'
      },
      upgradedAt: userPlan.upgradedAt
    });

  } catch (error) {
    console.error('Error in user plan endpoint:', error);
    return NextResponse.json(
      { error: 'internal_error', error_description: 'Internal server error' },
      { status: 500 }
    );
  }
}
