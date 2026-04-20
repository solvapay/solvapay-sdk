import { NextResponse } from 'next/server'
import type { SolvaPay, PaymentMethodInfo } from '@solvapay/server'
import { getPaymentMethodCore, isErrorResult } from '@solvapay/server'

/**
 * Next.js wrapper around `getPaymentMethodCore`.
 *
 * @example
 * ```ts
 * // app/api/payment-method/route.ts
 * import { getPaymentMethod } from '@solvapay/next/helpers'
 *
 * export async function GET(req: Request) {
 *   return getPaymentMethod(req)
 * }
 * ```
 */
export async function getPaymentMethod(
  request: globalThis.Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<PaymentMethodInfo | NextResponse> {
  const result = await getPaymentMethodCore(request, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
