import { NextRequest, NextResponse } from 'next/server'
import { cancelPurchase } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { purchaseRef, reason } = await request.json()

  const result = await cancelPurchase(request, { purchaseRef, reason })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
