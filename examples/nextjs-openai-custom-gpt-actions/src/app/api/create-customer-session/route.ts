import { NextRequest, NextResponse } from 'next/server'
import { createCustomerSession } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const result = await createCustomerSession(request)
  console.log('createCustomerSession result', result)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
