import { NextRequest } from 'next/server'
import { createPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()
  return createPaymentIntent(request, { planRef, productRef })
}
