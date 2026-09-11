import { NextRequest } from 'next/server'
import { cancelRenewal } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { purchaseRef, reason } = await request.json()
  return cancelRenewal(request, { purchaseRef, reason })
}
