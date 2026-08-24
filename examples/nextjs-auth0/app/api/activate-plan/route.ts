import { NextRequest } from 'next/server'
import { activatePlan } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { productRef, planRef } = await request.json()
  return activatePlan(request, { productRef, planRef })
}
