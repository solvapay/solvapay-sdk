// `@solvapay/agents/http`: SolvaPay agent payments for an HTTP API. The gate
// reads the presented key: a SolvaPay agent token is verified and the call
// authorized; anything else is left to the merchant's own auth. The merchant
// forwards an allowed call, then completes it with the cost the upstream
// reported (`allowed.finish`), or releases it when the upstream was never
// reached (`allowed.release`). Framework-neutral: Request in, plain results out.
import type { MoneyAmount } from './client'
import type { AgentCalls, Allowed, Logger, RefusalReason, Refused } from './calls'
import type { AgentLayer, VerifiedAgent } from './identity'
import type { PromptFacts } from './prompt'

export type GateResult =
  /** Not a SolvaPay agent token: the merchant's own auth decides. */
  | { kind: 'not_agent' }
  /** An agent token that did not verify (expired, forged, for another merchant). */
  | { kind: 'rejected'; status: 401; reason: 'expired' | 'invalid'; detail: string }
  | { kind: 'refused'; status: RefusalStatus; refused: Refused; agent: VerifiedAgent }
  | { kind: 'allowed'; allowed: Allowed; agent: VerifiedAgent }

export interface GateCall {
  /** The key the caller presented (bearer token or API key header). */
  presentedKey: string
  /** The merchant's id for the call; SolvaPay keys the call on it. */
  requestId: string
  /** The merchant's label for what the call buys (a model id, an endpoint). */
  item: string
  /** What the call may cost, in the merchant's currency. */
  estimate: MoneyAmount
  prompt: PromptFacts | null
  /** Ends a wait for the owner when the caller goes away. */
  signal: AbortSignal
  logFields?: Record<string, unknown>
}

export function createAgentHttpGate(deps: {
  agentLayer: AgentLayer
  calls: AgentCalls
  log: Logger
}): (call: GateCall) => Promise<GateResult> {
  return async call => {
    const identity = await deps.agentLayer.identify(call.presentedKey)
    if (identity.kind === 'not_agent') return { kind: 'not_agent' }
    if (identity.kind === 'rejected') {
      deps.log.info('call.rejected', {
        requestId: call.requestId,
        ...call.logFields,
        reason: `agent_token_${identity.reason}`,
        detail: identity.detail,
      })
      return { kind: 'rejected', status: 401, reason: identity.reason, detail: identity.detail }
    }
    const begun = await deps.calls.begin({
      requestId: call.requestId,
      agentToken: call.presentedKey,
      agent: identity.agent,
      item: call.item,
      estimate: call.estimate,
      prompt: call.prompt,
      signal: call.signal,
      ...(call.logFields ? { logFields: call.logFields } : {}),
    })
    if (begun.kind === 'refused') {
      return {
        kind: 'refused',
        status: refusalStatus(begun.reason),
        refused: begun,
        agent: identity.agent,
      }
    }
    return { kind: 'allowed', allowed: begun, agent: identity.agent }
  }
}

export type RefusalStatus = 401 | 402 | 422 | 502

/**
 * The HTTP status for a refusal. 402 for anything money or the owner can
 * settle (link the account, top up, approve), so a client shows the reason
 * instead of retrying; 422 for a policy deny; 401 for an agent SolvaPay did
 * not accept; 502 when SolvaPay could not be reached.
 */
export function refusalStatus(reason: RefusalReason): RefusalStatus {
  switch (reason) {
    case 'agent_not_accepted':
      return 401
    case 'unavailable':
      return 502
    case 'deny':
      return 422
    case 'customer_not_linked':
    case 'topup_required':
    case 'ask':
    case 'approval_declined':
    case 'approval_expired':
    case 'approval_timed_out':
    case 'approval_client_closed':
      return 402
    default: {
      const unknown: never = reason
      throw new Error(`Refusal reason ${JSON.stringify(unknown)} has no status`)
    }
  }
}

/** A plain JSON refusal, for a merchant with no error format of its own. */
export function refusalResponse(refused: Refused): Response {
  return Response.json(
    { error: { type: refused.reason, message: refused.message } },
    { status: refusalStatus(refused.reason) },
  )
}
