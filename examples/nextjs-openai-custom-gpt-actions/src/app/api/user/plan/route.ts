import { NextRequest, NextResponse } from 'next/server'
import { createSolvaPay, getAuthenticatedUserCore, isErrorResult } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export async function GET(request: NextRequest) {
  try {
    const solvaPay = getSolvaPay()
    
    // Use SDK helper to extract user ID from request
    const userResult = await getAuthenticatedUserCore(request)
    
    if (isErrorResult(userResult)) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status }
      )
    }
    
    const { userId } = userResult
    
    // Get customer details directly using the external reference (Supabase User ID)
    // We rely on the customer being synced during login/signup (see /api/sync-customer)
    // This avoids the overhead of "ensuring" customer existence on every plan check
    // Keep userId as-is (with hyphens) to match what was stored
    const customer = await solvaPay.getCustomer({ 
      externalRef: userId 
    })
    
    // Return actual subscription data from backend (no hardcoded mapping)
    // Find the first active or trialing subscription
    const activeSubscription = customer.subscriptions?.find(
      (sub) => sub.status === 'active' || sub.status === 'trialing'
    )
    
    return NextResponse.json({
      // Return actual plan data from backend
      subscription: activeSubscription || null,
      subscriptions: customer.subscriptions || [],
      customer: {
        customerRef: customer.customerRef,
        email: customer.email,
        externalRef: customer.externalRef,
      },
    })
  } catch (error) {
    console.error('Error getting user plan:', error)
    
    // Return an error response instead of a default free plan
    // This provides better transparency about what went wrong
    return NextResponse.json(
      { 
        error: 'Failed to fetch customer data',
        subscription: null,
        subscriptions: [],
      },
      { status: 500 }
    )
  }
}

