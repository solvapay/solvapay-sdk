import { NextRequest, NextResponse } from 'next/server'
import { createPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()

  const result = await createPaymentIntent(request, { planRef, productRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
