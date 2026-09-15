import { validateActivatePlanParams } from '../native-decisions'
import type { SolvaPay } from '../factory'
import type { ActivatePlanResult } from '../types/client'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

export async function activatePlanCore(
  request: Request,
  body: {
    productRef: string
    planRef: string
  },
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<ActivatePlanResult | ErrorResult> {
  try {
    const validationError = validateActivatePlanParams(body.productRef, body.planRef)
    if (validationError) {
      return validationError
    }

    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult
    const solvaPay = options.solvaPay || createSolvaPay()

    return await solvaPay.activatePlan({
      customerRef,
      productRef: body.productRef,
      planRef: body.planRef,
    })
  } catch (error) {
    return handleRouteError(error, 'Activate plan', 'Plan activation failed')
  }
}
