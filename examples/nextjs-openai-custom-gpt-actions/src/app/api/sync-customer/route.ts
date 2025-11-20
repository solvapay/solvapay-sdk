import { NextRequest, NextResponse } from 'next/server'
import { syncCustomer } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const customerRef = await syncCustomer(request)

  if (customerRef instanceof NextResponse) {
    return customerRef
  }
  
  return NextResponse.json({
    customerRef,
    success: true,
  })
}
