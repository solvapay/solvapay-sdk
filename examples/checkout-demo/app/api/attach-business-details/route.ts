import { NextRequest } from 'next/server'
import { attachBusinessDetails } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const body = await request.json()
  return attachBusinessDetails(request, body)
}
