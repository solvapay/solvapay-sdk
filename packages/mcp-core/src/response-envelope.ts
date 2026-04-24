/**
 * Runtime helpers for the `ResponseResult` envelope. Intentionally
 * module-internal — not re-exported from `@solvapay/mcp`'s public
 * entry point. Merchants produce envelopes via `ctx.respond(...)` and
 * the SDK unwraps them inside `buildPayableHandler`.
 *
 * After the legacy raw-return handler shape was removed, the brand
 * check (`__solvapayResponse: true`) exists solely as an internal
 * invariant assert at the adapter boundary: it guarantees the value
 * `buildPayableHandler` sees really did come from `ctx.respond(...)`
 * and fails loudly with a merchant-actionable error when a handler
 * bypasses the TS contract (plain JS, `any`, `@ts-ignore`) and returns
 * raw data.
 */

import type { ContentBlock, ResponseOptions, ResponseResult } from './types'

/**
 * Type guard for `ResponseResult`. Matches by the branded field so
 * structural equivalents (e.g. a plain object a merchant happened to
 * shape this way) could technically collide — but we treat the
 * likelihood as negligible and document the brand as opaque.
 *
 * Module-internal: consumers should prefer `assertResponseResult`
 * which throws with the merchant-actionable message.
 */
function isResponseResult(value: unknown): value is ResponseResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __solvapayResponse?: unknown }).__solvapayResponse === true
  )
}

/**
 * Assert that `value` is a `ResponseResult` envelope. Throws with a
 * merchant-actionable message when the invariant fails so a plain-JS
 * handler that returned raw data gets pointed at the fix instead of a
 * cryptic `TypeError` further down the unwrap path.
 *
 * Fires in two cases:
 *  1. A merchant bypassed the TypeScript contract and returned raw
 *     data from their `registerPayable` handler.
 *  2. An internal SDK bug routed a non-envelope value to the unwrap
 *     helper. The message's second sentence invites a bug report.
 */
export function assertResponseResult(value: unknown): ResponseResult<unknown> {
  if (!isResponseResult(value)) {
    throw new Error(
      'SolvaPay: registerPayable handler returned a raw value. ' +
        'Handlers must return ctx.respond(data, options?). ' +
        'If you believe you did, this is an internal bug — please file ' +
        'an issue at https://github.com/solvapay/solvapay-sdk/issues.',
    )
  }
  return value
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
