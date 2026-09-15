/**
 * Runtime helpers for the `ResponseResult` envelope. Adapter-internal —
 * exported from `@solvapay/mcp-core` for adapters / contract fixtures,
 * but not re-exported from `@solvapay/mcp`'s public entry. Merchants
 * produce envelopes via `ctx.respond(...)` and the SDK unwraps them
 * inside `buildPayableHandler`.
 *
 * After the legacy raw-return handler shape was removed, the brand
 * check (`__solvapayResponse: true`) exists solely as an internal
 * invariant assert at the adapter boundary: it guarantees the value
 * `buildPayableHandler` sees really did come from `ctx.respond(...)`
 * and fails loudly with a merchant-actionable error when a handler
 * bypasses the TS contract (plain JS, `any`, `@ts-ignore`) and returns
 * raw data.
 *
 * Constructors live in the native dispatch layer so every language
 * shares the Rust envelope.
 */

export { assertResponseResult, makeResponseResult } from './native-mcp'
