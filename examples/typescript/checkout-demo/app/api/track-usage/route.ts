import { NextRequest } from 'next/server'
import { trackUsage } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const body = await request.json()
  return trackUsage(request, body)
}
