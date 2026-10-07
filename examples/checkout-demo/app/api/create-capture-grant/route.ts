import { NextRequest } from 'next/server'
import { createCaptureGrant } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId } = await request.json()
  return createCaptureGrant(request, { paymentIntentId })
}
