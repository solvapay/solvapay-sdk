import { NextRequest, NextResponse } from 'next/server'
import { activatePlan } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { productRef, planRef } = await request.json()

  const result = await activatePlan(request, { productRef, planRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
