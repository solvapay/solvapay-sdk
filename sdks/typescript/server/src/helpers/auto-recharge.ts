import type {
  AutoRechargeInput,
  AutoRechargeResponse,
  SaveAutoRechargeResponse,
} from '../types/client'
import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

type HelperOptions = {
  solvaPay?: SolvaPay
  includeEmail?: boolean
  includeName?: boolean
}

async function resolveCustomerRef(
  request: Request,
  options: HelperOptions,
): Promise<string | ErrorResult> {
  return syncCustomerCore(request, {
    solvaPay: options.solvaPay,
    includeEmail: options.includeEmail,
    includeName: options.includeName,
  })
}

export async function getAutoRechargeCore(
  request: Request,
  options: HelperOptions = {},
): Promise<AutoRechargeResponse | ErrorResult> {
  try {
    const customerRef = await resolveCustomerRef(request, options)
    if (isErrorResult(customerRef)) return customerRef

    const solvaPay = options.solvaPay ?? createSolvaPay()
    if (!solvaPay.apiClient.getAutoRecharge) {
      return { error: 'getAutoRecharge is not implemented on this API client', status: 500 }
    }

    return await solvaPay.apiClient.getAutoRecharge({ customerRef })
  } catch (error) {
    return handleRouteError(error, 'Get auto-recharge', 'Failed to load auto-recharge')
  }
}

export async function saveAutoRechargeCore(
  request: Request,
  input: AutoRechargeInput,
  options: HelperOptions = {},
): Promise<SaveAutoRechargeResponse | ErrorResult> {
  try {
    const customerRef = await resolveCustomerRef(request, options)
    if (isErrorResult(customerRef)) return customerRef

    const solvaPay = options.solvaPay ?? createSolvaPay()
    if (!solvaPay.apiClient.saveAutoRecharge) {
      return { error: 'saveAutoRecharge is not implemented on this API client', status: 500 }
    }

    return await solvaPay.apiClient.saveAutoRecharge({ customerRef, ...input })
  } catch (error) {
    return handleRouteError(error, 'Save auto-recharge', 'Failed to save auto-recharge')
  }
}

export async function disableAutoRechargeCore(
  request: Request,
  options: HelperOptions = {},
): Promise<{ success: true } | ErrorResult> {
  try {
    const customerRef = await resolveCustomerRef(request, options)
    if (isErrorResult(customerRef)) return customerRef

    const solvaPay = options.solvaPay ?? createSolvaPay()
    if (!solvaPay.apiClient.disableAutoRecharge) {
      return { error: 'disableAutoRecharge is not implemented on this API client', status: 500 }
    }

    return await solvaPay.apiClient.disableAutoRecharge({ customerRef })
  } catch (error) {
    return handleRouteError(error, 'Disable auto-recharge', 'Failed to disable auto-recharge')
  }
}
