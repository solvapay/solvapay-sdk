import { NextRequest, NextResponse } from 'next/server'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export async function GET(request: NextRequest) {
  try {
    const solvaPay = getSolvaPay()
    const userId = request.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Get customer information which includes subscriptions
    const customer = await solvaPay.getCustomer({ customerRef: userId })
    
    // Determine plan from subscriptions
    const hasActiveSubscription = customer.subscriptions?.some(
      (sub) => sub.status === 'active' || sub.status === 'trialing'
    )
    
    return NextResponse.json({
      plan: hasActiveSubscription ? 'pro' : 'free',
      usage: {
        api_calls: 0, // This could be tracked separately if needed
        last_reset: new Date().toISOString(),
      },
      limits: {
        api_calls: hasActiveSubscription ? -1 : 10, // -1 for unlimited
        reset_period: 'monthly',
      },
      upgradedAt: customer.subscriptions?.[0]?.startDate,
    })
  } catch (error) {
    console.error('Error getting user plan:', error)
    
    // Return a default free plan if there's an error
    // This prevents the Custom GPT from completely failing
    return NextResponse.json({
      plan: 'free',
      usage: {
        api_calls: 0,
        last_reset: new Date().toISOString(),
      },
      limits: {
        api_calls: 10,
        reset_period: 'monthly',
      },
    })
  }
}

