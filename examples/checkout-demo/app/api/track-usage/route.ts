import { NextRequest, NextResponse } from 'next/server'
import { trackUsage } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const result = await trackUsage(request, body)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
