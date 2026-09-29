import { NextRequest } from 'next/server'
import { getPaymentMethod, removePaymentMethod } from '@solvapay/next'

export const GET = (request: NextRequest) => getPaymentMethod(request)
export const DELETE = (request: NextRequest) => removePaymentMethod(request)
