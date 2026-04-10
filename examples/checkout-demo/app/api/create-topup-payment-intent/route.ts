import { NextRequest, NextResponse } from 'next/server'
import { createTopupPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { amount, currency } = await request.json()

  const result = await createTopupPaymentIntent(request, { amount, currency })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
