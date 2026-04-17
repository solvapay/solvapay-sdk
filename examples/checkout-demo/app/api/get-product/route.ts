import { NextRequest, NextResponse } from 'next/server'
import { getProduct } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await getProduct(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
