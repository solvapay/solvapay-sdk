import { NextRequest } from 'next/server'
import { getProduct } from '@solvapay/next'

export const GET = (request: NextRequest) => getProduct(request)
