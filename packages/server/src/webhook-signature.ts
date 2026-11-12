import { SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'

/**
 * The runtime-independent half of webhook verification, shared by the Node
 * (`index.ts`) and Web Crypto (`edge.ts`) verifiers so they cannot drift.
 * Only computing the HMAC differs between runtimes.
 *
 * SolvaPay signs a delivery as HMAC-SHA256 over `"{t}.{rawBody}"`, keyed by
 * the whole secret string (`whsec_…`, UTF-8), and sends it in the
 * `SV-Signature` header as `t={unix seconds},v1={lowercase hex}`.
 *
 * Every failure carries a stable `code`, so callers (and the conformance
 * suite every SDK runs) branch on the code, not the message.
 */

/** How far a signature's timestamp may be from now, either way. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

export const WEBHOOK_ERROR_CODES = {
  missing: 'webhook_signature_missing',
  malformed: 'webhook_signature_malformed',
  timestamp: 'webhook_timestamp_out_of_tolerance',
  invalid: 'webhook_signature_invalid',
  payload: 'webhook_payload_invalid',
} as const
export type WebhookErrorCode = (typeof WEBHOOK_ERROR_CODES)[keyof typeof WEBHOOK_ERROR_CODES]

export interface VerifyWebhookOptions {
  /** The raw request body, exactly as received. */
  body: string
  /** The `SV-Signature` header. */
  signature: string
  /** The endpoint's signing secret, `whsec_…`. */
  secret: string
  /** The time to check the signature's timestamp against. Defaults to now. */
  now?: Date
}

export interface ParsedSignature {
  timestamp: number
  /** The `v1` signature, as sent. */
  v1: string
  /** The exact bytes that were signed: `"{t}.{body}"`. */
  signedPayload: string
}

const fail = (code: WebhookErrorCode, message: string): never => {
  throw new SolvaPayError(message, { code })
}

/**
 * Parses the header and checks the timestamp. Returns what the caller must
 * HMAC and compare. The first `t=` and the first `v1=` are used.
 */
export function parseWebhookSignature({
  body,
  signature,
  now,
}: Omit<VerifyWebhookOptions, 'secret'>): ParsedSignature {
  if (!signature) fail(WEBHOOK_ERROR_CODES.missing, 'Missing webhook signature')

  const parts = signature.split(',').map(part => part.trim())
  const tPart = parts.find(part => part.startsWith('t='))
  const v1Part = parts.find(part => part.startsWith('v1='))
  if (!tPart || !v1Part) {
    return fail(WEBHOOK_ERROR_CODES.malformed, 'Malformed webhook signature')
  }

  const rawTimestamp = tPart.slice(2)
  const v1 = v1Part.slice(3)
  if (!/^\d+$/.test(rawTimestamp) || !v1) {
    return fail(WEBHOOK_ERROR_CODES.malformed, 'Malformed webhook signature')
  }
  const timestamp = Number(rawTimestamp)

  const nowSeconds = Math.floor((now ?? new Date()).getTime() / 1000)
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    fail(
      WEBHOOK_ERROR_CODES.timestamp,
      `Webhook signature timestamp is more than ${WEBHOOK_TOLERANCE_SECONDS} seconds from now`,
    )
  }

  return { timestamp, v1, signedPayload: `${rawTimestamp}.${body}` }
}

/** Constant-time comparison of two hex strings. */
export function signaturesMatch(expected: string, received: string): boolean {
  if (expected.length !== received.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return mismatch === 0
}

/** Compares the signature, then parses the verified body. */
export function finishWebhookVerification(
  expectedHmac: string,
  parsed: ParsedSignature,
  body: string,
): WebhookEvent {
  if (!signaturesMatch(expectedHmac, parsed.v1)) {
    fail(WEBHOOK_ERROR_CODES.invalid, 'Invalid webhook signature')
  }
  try {
    return JSON.parse(body) as WebhookEvent
  } catch {
    return fail(WEBHOOK_ERROR_CODES.payload, 'Invalid webhook payload: body is not valid JSON')
  }
}
