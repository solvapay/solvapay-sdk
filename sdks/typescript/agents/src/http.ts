// `@solvapay/agents/http`: SolvaPay agent payments for an HTTP API. The gate
// reads the presented key: a SolvaPay agent token is verified and the call
// authorized; anything else is left to the merchant's own auth. The merchant
// forwards an allowed call, then completes it with the cost the upstream
// reported (`allowed.finish`), or releases it when the upstream was never
// reached (`allowed.release`). Framework-neutral: Request in, plain results out.
import type { MoneyAmount } from './client'
import type { AgentCalls, Allowed, Logger, RefusalReason, Refused } from './calls'
import type { AgentLayer, AgentRejectionReason, VerifiedAgent } from './identity'
import { challengeHeaders, type ProtectedResource } from './oauth'
import type { PromptFacts } from './prompt'

export type GateResult =
  /** Not a SolvaPay agent token: the merchant's own auth decides. */
  | { kind: 'not_agent' }
  /**
   * An agent token or key that did not verify (expired, forged, for another
   * merchant): 401. One from the other environment: 403, as SolvaPay answers.
   */
  | {
      kind: 'rejected'
      status: 401 | 403
      reason: AgentRejectionReason
      detail: string
      /** With `protectedResource`, on a 401: the headers that send a host to sign in again. */
      challenge?: Headers
    }
  | {
      kind: 'refused'
      status: RefusalStatus
      refused: Refused
      agent: VerifiedAgent
      /** With `protectedResource`, on a 401 (`agent_not_accepted`). */
      challenge?: Headers
    }
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
  /** Turns the OAuth challenge on: 401 results carry the headers that send a host to sign in. */
  protectedResource?: ProtectedResource
}): (call: GateCall) => Promise<GateResult> {
  const challenge = (description: string) =>
    deps.protectedResource
      ? { challenge: challengeHeaders(deps.protectedResource, description) }
      : {}
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
      const status = identity.reason === 'environment_mismatch' ? 403 : 401
      return {
        kind: 'rejected',
        status,
        reason: identity.reason,
        detail: identity.detail,
        ...(status === 401 ? challenge('The agent token was not accepted: sign in again') : {}),
      }
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
      const status = refusalStatus(begun.reason)
      return {
        kind: 'refused',
        status,
        refused: begun,
        agent: identity.agent,
        ...(status === 401 ? challenge(begun.message) : {}),
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

/**
 * A plain JSON refusal, for a merchant with no error format of its own. Pass
 * the gate's `challenge` and a 401 carries it, so a host signs in again.
 */
export function refusalResponse(refused: Refused, challenge?: Headers): Response {
  const status = refusalStatus(refused.reason)
  return Response.json(
    { error: { type: refused.reason, message: refused.message } },
    { status, ...(status === 401 && challenge ? { headers: challenge } : {}) },
  )
}
