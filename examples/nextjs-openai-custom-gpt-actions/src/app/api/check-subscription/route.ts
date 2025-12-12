import { NextRequest, NextResponse } from 'next/server'
import { checkSubscription } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request)
  console.log('checkSubscription result', result)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
