import { NextRequest, NextResponse } from 'next/server'
import { createSolvaPay, getAuthenticatedUserCore, isErrorResult } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export async function GET(request: NextRequest) {
  try {
    const solvaPay = getSolvaPay()
    
    const userResult = await getAuthenticatedUserCore(request)
    
    if (isErrorResult(userResult)) {
      return NextResponse.json(
        { error: userResult.error },
        { status: userResult.status }
      )
    }
    
    const { userId } = userResult
    
    const customer = await solvaPay.getCustomer({ 
      customerRef: userId 
    })
    
    const activePurchase = customer.purchases?.find(
      (p) => p.status === 'active' || p.status === 'trialing'
    )
    
    const subscription = activePurchase ? {
      productName: activePurchase.productName,
      status: activePurchase.status,
      isActive: activePurchase.status === 'active' || activePurchase.status === 'trialing',
    } : null
    
    return NextResponse.json({
      subscription,
      customer: {
        customerRef: customer.customerRef,
        email: customer.email,
        externalRef: customer.externalRef,
      },
    })
  } catch (error) {
    console.error('Error getting user subscription:', error)
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch customer data',
        subscription: null,
      },
      { status: 500 }
    )
  }
}
