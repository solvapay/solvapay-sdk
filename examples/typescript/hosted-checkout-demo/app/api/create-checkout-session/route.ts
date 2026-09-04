import { NextRequest } from 'next/server'
import { createCheckoutSession } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()
  return createCheckoutSession(request, { productRef, planRef })
}
