/**
 * Edge profile of `@solvapay/server-wasm`.
 *
 * Call {@link ready} once (or await it before each use — it is idempotent)
 * before invoking {@link verifyWebhook}.
 */

/** Resolves when the edge WASM module has been instantiated. */
export function ready(): Promise<void>

/** Returns the binding crate version string. */
export function wasmVersion(): string

/**
 * Verifies a webhook signature and returns the parsed JSON body string.
 *
 * @param body - Raw request body
 * @param signature - `SV-Signature` header value
 * @param secret - Webhook secret (`whsec_…`)
 * @param nowUnixSecs - Host clock as unix seconds
 * @throws Error with snake_case `code` on verification failure
 */
export function verifyWebhook(
  body: string,
  signature: string,
  secret: string,
  nowUnixSecs: number,
): string
