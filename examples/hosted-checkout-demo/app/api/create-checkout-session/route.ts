import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()

  const result = await createCheckoutSession(request, { productRef, planRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
