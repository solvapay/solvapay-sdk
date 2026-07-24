import { NextRequest } from 'next/server'
import { processPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId, productRef, planRef } = await request.json()
  return processPaymentIntent(request, { paymentIntentId, productRef, planRef })
}
