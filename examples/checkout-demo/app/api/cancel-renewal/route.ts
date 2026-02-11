import { NextRequest, NextResponse } from 'next/server'
import { cancelRenewal } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { purchaseRef, reason } = await request.json()

  const result = await cancelRenewal(request, { purchaseRef, reason })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
