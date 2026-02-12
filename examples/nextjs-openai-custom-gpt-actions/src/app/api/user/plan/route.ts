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
    
    // Get customer details
    // In the SolvaPay Hosted OAuth flow, the authenticated user ID (from the token)
    // corresponds to the Customer Reference (or ID) in the SolvaPay system.
    // We use customerRef to identify the customer.
    const customer = await solvaPay.getCustomer({ 
      customerRef: userId 
    })
    
    // Return actual purchase data from backend (no hardcoded mapping)
    // Find the first active or trialing purchase
    const activePurchase = customer.purchases?.find(
      (p) => p.status === 'active' || p.status === 'trialing'
    )
    
    // Transform purchase to simplified plan info for OpenAPI
    const plan = activePurchase ? {
      // planRef: activePurchase.planRef, // TODO: review if we need to add planRef
      planName: activePurchase.planName,
      // planType: activePurchase.planType, // TODO: review if we need to add planType
      status: activePurchase.status,
      isActive: activePurchase.status === 'active' || activePurchase.status === 'trialing',
      // isRecurring: activePurchase.isRecurring, // TODO: review if we need to add isRecurring
    } : null
    
    return NextResponse.json({
      plan,
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
        plan: null,
      },
      { status: 500 }
    )
  }
}

