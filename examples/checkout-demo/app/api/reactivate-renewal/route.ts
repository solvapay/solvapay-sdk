import { NextRequest, NextResponse } from 'next/server'
import { reactivateRenewal } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { purchaseRef } = await request.json()

  const result = await reactivateRenewal(request, { purchaseRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
