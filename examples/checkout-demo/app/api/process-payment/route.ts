import { NextRequest, NextResponse } from 'next/server'
import { processPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId, productRef, planRef } = await request.json()

  const result = await processPaymentIntent(request, { paymentIntentId, productRef, planRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
