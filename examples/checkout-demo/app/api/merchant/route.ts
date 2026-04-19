import { NextRequest, NextResponse } from 'next/server'
import { getMerchant } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await getMerchant(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
