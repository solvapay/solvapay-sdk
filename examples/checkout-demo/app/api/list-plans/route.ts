import { NextRequest } from 'next/server'
import { listPlans } from '@solvapay/next'

export const GET = (request: NextRequest) => listPlans(request)
