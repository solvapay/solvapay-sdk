import { NextRequest } from 'next/server'
import { createCardSetupGrant } from '@solvapay/next'

export async function POST(request: NextRequest) {
  return createCardSetupGrant(request)
}
