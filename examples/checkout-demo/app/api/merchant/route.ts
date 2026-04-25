import { NextRequest } from 'next/server'
import { getMerchant } from '@solvapay/next'

export const GET = (request: NextRequest) => getMerchant(request)
