import { NextResponse } from 'next/server'
import { getMerchantCore, isErrorResult } from '@solvapay/server'

type GetMerchantSuccess = Exclude<
  Awaited<ReturnType<typeof getMerchantCore>>,
  { error: string }
>

/**
 * Next.js route wrapper for GET /api/merchant.
 *
 * @example
 * ```ts
 * // app/api/merchant/route.ts
 * import { getMerchant } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getMerchant(request)
 * ```
 */
export async function getMerchant(
  request: globalThis.Request,
): Promise<GetMerchantSuccess | NextResponse> {
  const result = await getMerchantCore(request)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
