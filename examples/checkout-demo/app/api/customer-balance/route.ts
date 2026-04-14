import { NextRequest, NextResponse } from 'next/server'
import { getCustomerBalance } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await getCustomerBalance(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
