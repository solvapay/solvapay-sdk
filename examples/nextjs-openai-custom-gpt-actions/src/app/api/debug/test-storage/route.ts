import { NextRequest, NextResponse } from 'next/server';
import { updateUserPlan, loadUserPlans } from '@/lib/storage-adapter';

/**
 * Debug endpoint to test storage operations
 */
export async function GET() {
  console.log('🔍 [TEST STORAGE] Starting storage test...');
  
  try {
    // Test 1: Load current plans
    console.log('🔍 [TEST STORAGE] Loading current plans...');
    const currentPlans = await loadUserPlans();
    console.log('🔍 [TEST STORAGE] Current plans:', currentPlans);
    
    // Test 2: Update a test user plan
    console.log('🔍 [TEST STORAGE] Updating test user plan...');
    const testUserId = 'test-user-' + Date.now();
    const testPlan = 'pro';
    
    const updatedPlan = await updateUserPlan(testUserId, testPlan);
    console.log('🔍 [TEST STORAGE] Updated plan:', updatedPlan);
    
    // Test 3: Load plans again to verify
    console.log('🔍 [TEST STORAGE] Loading plans after update...');
    const plansAfterUpdate = await loadUserPlans();
    console.log('🔍 [TEST STORAGE] Plans after update:', plansAfterUpdate);
    
    return NextResponse.json({
      success: true,
      testUserId,
      testPlan,
      updatedPlan,
      currentPlans,
      plansAfterUpdate,
      storage: process.env.VERCEL ? 'Vercel KV' : 'Local File'
    });
    
  } catch (error) {
    console.error('❌ [TEST STORAGE] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      storage: process.env.VERCEL ? 'Vercel KV' : 'Local File'
    }, { status: 500 });
  }
}
