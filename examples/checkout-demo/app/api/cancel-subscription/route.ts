import { NextRequest, NextResponse } from 'next/server'
import { cancelSubscription } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { subscriptionRef, reason } = await request.json()

  const result = await cancelSubscription(request, { subscriptionRef, reason })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
