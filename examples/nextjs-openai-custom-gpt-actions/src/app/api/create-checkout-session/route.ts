import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json()

  console.log('createCheckoutSession', { planRef, agentRef })
  const result = await createCheckoutSession(request, { agentRef, planRef })
  console.log('createCheckoutSession result', result)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
