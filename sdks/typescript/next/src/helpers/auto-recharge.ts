import type { NextResponse } from 'next/server'
import type { AutoRechargeInput, SolvaPay } from '@solvapay/server'
import {
  disableAutoRechargeCore,
  getAutoRechargeCore,
  saveAutoRechargeCore,
} from '@solvapay/server'
import { toNextRouteResponse } from './_response'

type AutoRechargeOptions = {
  solvaPay?: SolvaPay
  includeEmail?: boolean
  includeName?: boolean
}

export async function getAutoRecharge(
  request: globalThis.Request,
  options: AutoRechargeOptions = {},
): Promise<NextResponse> {
  const result = await getAutoRechargeCore(request, options)
  return toNextRouteResponse(result)
}

export async function saveAutoRecharge(
  request: globalThis.Request,
  inputOrOptions: AutoRechargeInput | AutoRechargeOptions = {},
  maybeOptions: AutoRechargeOptions = {},
): Promise<NextResponse> {
  const hasInput = 'enabled' in inputOrOptions
  const input = hasInput ? inputOrOptions : ((await request.json()) as AutoRechargeInput)
  const options = hasInput ? maybeOptions : inputOrOptions
  const result = await saveAutoRechargeCore(request, input, options)
  return toNextRouteResponse(result)
}

export async function disableAutoRecharge(
  request: globalThis.Request,
  options: AutoRechargeOptions = {},
): Promise<NextResponse> {
  const result = await disableAutoRechargeCore(request, options)
  return toNextRouteResponse(result)
}
