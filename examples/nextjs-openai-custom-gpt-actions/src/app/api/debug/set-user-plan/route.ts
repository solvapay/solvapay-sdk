import { NextRequest, NextResponse } from 'next/server';
import { updateUserPlan } from '@/lib/storage-adapter';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id') || 'user_1';
  const plan = url.searchParams.get('plan') || 'pro';

  try {
    console.log('🔍 [SET USER PLAN] Setting plan for user:', { userId, plan });
    const updatedPlan = await updateUserPlan(userId, plan);
    console.log('✅ [SET USER PLAN] Plan updated successfully:', updatedPlan);
    
    return NextResponse.json({
      success: true,
      userId,
      plan,
      updatedPlan
    });
  } catch (error: any) {
    console.error('❌ [SET USER PLAN] Failed to update plan:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
