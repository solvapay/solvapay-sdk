import { NextRequest } from 'next/server'
import { reactivateRenewal } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { purchaseRef } = await request.json()
  return reactivateRenewal(request, { purchaseRef })
}
