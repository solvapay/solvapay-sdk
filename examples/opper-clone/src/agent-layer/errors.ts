// Error responses the clone gives on the paid route, in Anthropic's shape, so
// Claude Code shows the message as it is (build plan §7e, decision 7). The
// 401s stay in Opper's own shape, as Opper's are (FIDELITY.md).

export type AnthropicErrorType = 'invalid_request_error'

export interface AnthropicErrorBody {
  type: 'error'
  error: { type: AnthropicErrorType; message: string }
  request_id: string
}

export function anthropicError(
  status: number,
  message: string,
  requestId: string,
  type: AnthropicErrorType = 'invalid_request_error',
): Response {
  const body: AnthropicErrorBody = {
    type: 'error',
    error: { type, message },
    request_id: requestId,
  }
  return Response.json(body, { status })
}

/** Ask is 402 and deny 422, so Claude Code shows the reason once instead of retrying (checked live in 5.7). */
export function decisionError(
  action: 'ask' | 'deny',
  reasonText: string,
  requestId: string,
): Response {
  return anthropicError(action === 'ask' ? 402 : 422, reasonText, requestId)
}

export function customerNotLinked(requestId: string): Response {
  return anthropicError(
    402,
    'This agent has no payment set up with this merchant. Connect it in SolvaPay, then retry.',
    requestId,
  )
}

/** The gate's own message names the balance and the estimate. */
export function topupRequired(message: string, requestId: string): Response {
  return anthropicError(402, message, requestId)
}

export function badRequest(message: string, requestId: string): Response {
  return anthropicError(400, message, requestId)
}
