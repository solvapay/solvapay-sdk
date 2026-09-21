import { SolvaPayError } from './solvapay-error'

/** JSON error object carried by a native or WASM envelope. */
export type EnvelopeError = {
  kind: string
  message: string
  status?: number
  code?: string
  retryable?: boolean
  gate?: unknown
}

type EnvelopeOk = { ok: true; value: unknown }
type EnvelopeErr = { ok: false; error: EnvelopeError }
type Envelope = EnvelopeOk | EnvelopeErr

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  if (!('ok' in value)) return false
  const ok = (value as { ok: unknown }).ok
  return ok === true || ok === false
}

/**
 * Reconstructs a non-paywall envelope error.
 *
 * Paywall errors carry a gate payload and are rebuilt by `@solvapay/server`,
 * which passes its own `reconstruct` into {@link unwrapEnvelope}.
 */
export function reconstructSolvaPayEnvelopeError(error: EnvelopeError): SolvaPayError {
  const init: { status?: number; code?: string; kind?: string; retryable?: boolean } = {}
  if (typeof error.status === 'number') init.status = error.status
  if (typeof error.code === 'string') init.code = error.code
  if (typeof error.kind === 'string') init.kind = error.kind
  if (typeof error.retryable === 'boolean') init.retryable = error.retryable
  return new SolvaPayError(error.message, init)
}

/**
 * Parses a JSON envelope string and returns `value`, or throws.
 *
 * `source` is interpolated into parse-failure messages (`native binding`,
 * `WASM binding`, `browser WASM`).
 */
export function unwrapEnvelope(
  envelopeJson: string,
  source: string,
  reconstruct: (error: EnvelopeError) => Error = reconstructSolvaPayEnvelopeError,
): unknown {
  let envelope: unknown
  try {
    envelope = JSON.parse(envelopeJson) as unknown
  } catch {
    throw new SolvaPayError(`SolvaPay ${source} returned invalid JSON envelope`)
  }
  if (!isEnvelope(envelope)) {
    throw new SolvaPayError(`SolvaPay ${source} returned malformed envelope`)
  }
  if (envelope.ok) return envelope.value
  throw reconstruct(envelope.error)
}
