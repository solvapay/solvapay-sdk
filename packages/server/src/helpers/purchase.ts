import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { getAuthenticatedUserCore } from './auth'

export interface PurchaseCheckResult {
  customerRef: string
  email?: string
  name?: string
  purchases: Array<{
    reference: string
    productName?: string
    productRef?: string
    status?: string
    startDate?: string
    planSnapshot?: {
      meterId?: string
      limit?: number
      freeUnits?: number
    }
    usage?: {
      used?: number
      overageUnits?: number
      overageCost?: number
      periodStart?: string
      periodEnd?: string
    }
    [key: string]: unknown
  }>
}

export async function checkPurchaseCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<PurchaseCheckResult | ErrorResult> {
  try {
    const userResult = await getAuthenticatedUserCore(request, {
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(userResult)) {
      return userResult
    }

    const { userId, email, name } = userResult
    const solvaPay = options.solvaPay || createSolvaPay()

    const cachedCustomerRef = request.headers.get('x-solvapay-customer-ref')

    if (cachedCustomerRef) {
      try {
        const customer = await solvaPay.getCustomer({ customerRef: cachedCustomerRef })

        if (customer && customer.customerRef) {
          if (customer.externalRef && customer.externalRef === userId) {
            const filteredPurchases = (customer.purchases || []).filter(
              p => p.status === 'active',
            )

            return {
              customerRef: customer.customerRef,
              email: customer.email,
              name: customer.name,
              purchases: filteredPurchases,
            }
          }
        }
      } catch {
        // Cached ref is invalid, fall through to normal lookup
      }
    }

    try {
      const customerRef = await solvaPay.ensureCustomer(userId, userId, {
        email: email || undefined,
        name: name || undefined,
      })

      const customer = await solvaPay.getCustomer({ customerRef })

      const filteredPurchases = (customer.purchases || []).filter(p => p.status === 'active')

      return {
        customerRef: customer.customerRef || userId,
        email: customer.email,
        name: customer.name,
        purchases: filteredPurchases,
      }
    } catch {
      return {
        customerRef: userId,
        purchases: [],
      }
    }
  } catch (error) {
    return handleRouteError(error, 'Check purchase', 'Failed to check purchase')
  }
}
