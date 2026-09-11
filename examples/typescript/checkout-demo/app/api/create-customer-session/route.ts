import { createCustomerSession } from '@solvapay/next'

export const POST = (request: Request) => createCustomerSession(request)
