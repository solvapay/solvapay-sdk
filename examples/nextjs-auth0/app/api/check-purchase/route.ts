import { NextRequest } from 'next/server'
import { checkPurchase } from '@solvapay/next'

export const GET = (request: NextRequest) => checkPurchase(request)
