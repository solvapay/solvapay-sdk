import { NextRequest } from 'next/server'
import { attachTopupBusinessDetails } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const body = await request.json()
  return attachTopupBusinessDetails(request, body)
}
