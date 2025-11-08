import { NextRequest, NextResponse } from 'next/server'
import { processPayment } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId, agentRef, planRef } = await request.json()

  const result = await processPayment(request, { paymentIntentId, agentRef, planRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
