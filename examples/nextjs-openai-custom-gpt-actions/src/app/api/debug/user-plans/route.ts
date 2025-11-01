import { NextRequest, NextResponse } from 'next/server';
import { getAllUserPlans } from '@/services/userPlanService';

/**
 * Debug endpoint to check user plan status
 */
export async function GET() {
  console.log('🔍 [DEBUG] ===== User Plans Debug =====');
  
  // Force reload user plans from storage
  const userPlans = await getAllUserPlans();
  console.log('🔍 [DEBUG] Reloaded plans:', userPlans);
  
  return NextResponse.json({ 
    userPlans,
    storage: process.env.VERCEL ? 'Vercel KV' : 'Local File'
  });
}
