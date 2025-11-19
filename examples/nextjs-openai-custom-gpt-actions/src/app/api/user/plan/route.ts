import { NextRequest, NextResponse } from 'next/server'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export async function GET(request: NextRequest) {
  try {
    const solvaPay = getSolvaPay()
    
    // Get user plan information
    // This endpoint also serves as a health check for customer sync
    const result = await solvaPay.getUserPlan(request as any)
    
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error getting user plan:', error)
    
    // Return a default free plan if there's an error
    // This prevents the Custom GPT from completely failing
    return NextResponse.json({
      plan: 'free',
      features: {
        tasks_limit: 10,
        tasks_used: 0,
      },
      status: 'active',
    })
  }
}

