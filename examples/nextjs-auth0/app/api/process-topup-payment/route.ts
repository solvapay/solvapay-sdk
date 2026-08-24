import { NextRequest } from 'next/server'
import { processTopupPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId } = await request.json()
  return processTopupPaymentIntent(request, { paymentIntentId })
}
