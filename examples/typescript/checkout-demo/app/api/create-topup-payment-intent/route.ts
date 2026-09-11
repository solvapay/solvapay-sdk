import { NextRequest } from 'next/server'
import { createTopupPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { amount, currency, autoRecharge } = await request.json()
  return createTopupPaymentIntent(request, { amount, currency, autoRecharge })
}
