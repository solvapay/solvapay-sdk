import { NextRequest, NextResponse } from 'next/server';
import { loadUserPlans } from '@/lib/storage-adapter';

/**
 * Get user plan by user ID (internal endpoint)
 */
export async function GET(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const params = await context.params;
  const { userId } = params;
  
  const userPlans = await loadUserPlans();
  const userPlan = userPlans[userId];
  const currentPlan = userPlan?.plan || 'free';
  
  return NextResponse.json({
    userId,
    plan: currentPlan,
    upgradedAt: userPlan?.upgradedAt
  });
}
