import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { getAuthenticatedUserCore } from './auth'

export async function trackUsageCore(
  request: Request,
  body: {
    actionType?: 'transaction' | 'api_call' | 'hour' | 'email' | 'storage' | 'custom'
    units?: number
    productRef?: string
    description?: string
    metadata?: Record<string, unknown>
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<{ success: true } | ErrorResult> {
  try {
    const userResult = await getAuthenticatedUserCore(request)

    if (isErrorResult(userResult)) {
      return userResult
    }

    const { userId, email, name } = userResult
    const solvaPay = options.solvaPay || createSolvaPay()

    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    })

    await solvaPay.trackUsage({
      customerRef,
      actionType: body.actionType,
      units: body.units,
      productRef: body.productRef,
      description: body.description,
      metadata: body.metadata,
    })

    return { success: true }
  } catch (error) {
    return handleRouteError(error, 'Track usage', 'Track usage failed')
  }
}
