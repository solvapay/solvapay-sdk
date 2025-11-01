import { NextRequest, NextResponse } from 'next/server';
import { updateUserPlan } from '@/services/userPlanService';

/**
 * Debug endpoint to manually set user plan
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const user_id = url.searchParams.get('user_id');
  const plan = url.searchParams.get('plan');
  
  if (!user_id || !plan) {
    return NextResponse.json({ 
      error: 'Missing required parameters: user_id and plan' 
    }, { status: 400 });
  }
  
  console.log('🔍 [DEBUG] Setting user plan:', user_id, 'to', plan);
  
  const updatedPlan = await updateUserPlan(user_id, plan);
  
  console.log('🔍 [DEBUG] User plan set:', updatedPlan);
  
  return NextResponse.json({ 
    success: true, 
    user_id, 
    plan: updatedPlan.plan,
    upgradedAt: updatedPlan.upgradedAt
  });
}
