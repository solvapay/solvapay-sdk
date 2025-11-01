import { NextRequest, NextResponse } from 'next/server';
import { updateUserPlan } from '@/services/userPlanService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, plan } = body;
    
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    
    const updatedPlan = await updateUserPlan(userId, plan);
    
    return NextResponse.json({
      success: true,
      userId: userId,
      plan: updatedPlan.plan,
      upgradedAt: updatedPlan.upgradedAt
    });
  } catch (error) {
    console.error('Failed to update user plan:', error);
    return NextResponse.json({ error: 'Failed to update user plan' }, { status: 500 });
  }
}