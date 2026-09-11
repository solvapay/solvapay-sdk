import { NextRequest } from 'next/server'
import { createCustomerSession } from '@solvapay/next'

export const POST = (request: NextRequest) => createCustomerSession(request)
