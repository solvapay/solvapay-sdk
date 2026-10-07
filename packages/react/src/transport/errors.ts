/**
 * The error a transport throws for a non-2xx answer from the integrator's
 * route (HTTP) or the MCP server (`isError` tool result). It carries what
 * the backend keyed the refusal with, so the forms pick the payer's copy
 * by `code` and never by message text.
 *
 * The wire shape is the `ErrorResult` the `@solvapay/server` helpers
 * answer: `{ error, details?, code?, reason?, declineCode? }`.
 */

export interface TransportErrorInit {
  /** HTTP status of the answer (the MCP adapter reads it from `structuredContent.status`). */
  status?: number
  /** The backend's error key: `payment_declined`, `confirm_in_progress`, `card_not_found`, ... */
  code?: string
  /** Why a payment was not collected (402 `payment_declined`). */
  reason?: string
  /** Canonical decline code (402 `payment_declined`), when the rail gave one. */
  declineCode?: string
}

export class TransportError extends Error {
  readonly status?: number
  readonly code?: string
  readonly reason?: string
  readonly declineCode?: string

  constructor(message: string, init: TransportErrorInit = {}) {
    super(message)
    this.name = 'TransportError'
    this.status = init.status
    this.code = init.code
    this.reason = init.reason
    this.declineCode = init.declineCode
  }
}

/** The fields of an `ErrorResult` body, when `body` is one. */
export function readErrorBody(body: unknown): TransportErrorInit & { message?: string } {
  if (!body || typeof body !== 'object') return {}
  const record = body as Record<string, unknown>
  const message =
    typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : undefined
  return {
    ...(message !== undefined ? { message } : {}),
    ...(typeof record.status === 'number' ? { status: record.status } : {}),
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.declineCode === 'string' ? { declineCode: record.declineCode } : {}),
  }
}

/**
 * Build the `TransportError` for a non-OK fetch response: the body's
 * `error` text (else `fallbackPrefix: statusText`) with the keyed fields.
 */
export async function readTransportError(
  res: Response,
  fallbackPrefix: string,
): Promise<TransportError> {
  let body: unknown
  try {
    body = await res.clone().json()
  } catch {
    body = undefined
  }
  const fields = readErrorBody(body)
  const message = fields.message || `${fallbackPrefix}: ${res.statusText || res.status}`
  return new TransportError(message, {
    status: res.status,
    ...(fields.code ? { code: fields.code } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.declineCode ? { declineCode: fields.declineCode } : {}),
  })
}
