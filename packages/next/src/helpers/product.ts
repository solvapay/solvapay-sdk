import { NextResponse } from 'next/server'
import { getProductCore, isErrorResult } from '@solvapay/server'

type GetProductSuccess = Exclude<
  Awaited<ReturnType<typeof getProductCore>>,
  { error: string }
>

/**
 * Next.js route wrapper for GET /api/get-product?productRef=...
 *
 * @example
 * ```ts
 * // app/api/get-product/route.ts
 * import { getProduct } from '@solvapay/next/helpers'
 * export const GET = (request: Request) => getProduct(request)
 * ```
 */
export async function getProduct(
  request: globalThis.Request,
): Promise<GetProductSuccess | NextResponse> {
  const result = await getProductCore(request)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  return result
}
