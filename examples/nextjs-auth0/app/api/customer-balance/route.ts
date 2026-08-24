import { NextRequest } from 'next/server'
import { getCustomerBalance } from '@solvapay/next'

export const GET = (request: NextRequest) => getCustomerBalance(request)
