/**
 * Runtime helpers for the `ResponseResult` envelope. Intentionally
 * module-private — not re-exported from `@solvapay/mcp`'s public
 * entry point. Merchants produce envelopes via `ctx.respond(...)` and
 * the SDK unwraps them inside `buildPayableHandler`.
 */

import type { ContentBlock, ResponseOptions, ResponseResult } from './types'

/**
 * Type guard for `ResponseResult`. Matches by the branded field so
 * structural equivalents (e.g. a plain object a merchant happened to
 * shape this way) could technically collide — but we treat the
 * likelihood as negligible and document the brand as opaque.
 */
export function isResponseResult(value: unknown): value is ResponseResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __solvapayResponse?: unknown }).__solvapayResponse === true
  )
}

/**
 * Internal constructor for a `ResponseResult`. Used by
 * `ctx.respond(...)`.
 */
export function makeResponseResult<TData>(
  data: TData,
  options: ResponseOptions | undefined,
  emittedBlocks: ContentBlock[],
): ResponseResult<TData> {
  return {
    __solvapayResponse: true,
    data,
    ...(options !== undefined ? { options } : {}),
    ...(emittedBlocks.length > 0 ? { emittedBlocks: [...emittedBlocks] } : {}),
  }
}
