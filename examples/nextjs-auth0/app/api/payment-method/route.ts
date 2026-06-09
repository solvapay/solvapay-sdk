import { NextRequest } from 'next/server'
import { getPaymentMethod } from '@solvapay/next'

export const GET = (request: NextRequest) => getPaymentMethod(request)
