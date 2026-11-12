// `@solvapay/agents/http`: SolvaPay agent payments for an HTTP API. The gate
// reads the presented key: a SolvaPay agent token is verified and the call
// authorized; anything else is left to the merchant's own auth. The merchant
// forwards an allowed call, then completes it with the cost the upstream
// reported (`allowed.finish`), or releases it when the upstream was never
// reached (`allowed.release`). Framework-neutral: Request in, plain results out.
import type { MoneyAmount } from './client'
import type { AgentCalls, Allowed, Logger, RefusalReason, Refused } from './calls'
import type { AgentLayer, AgentRejectionReason, VerifiedAgent } from './identity'
import { agentGateResult, agentRefusalStatus } from './core'
import type { ProtectedResource } from './oauth'
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
  // The statuses, the challenge and its sentences come from the Rust core.
  const decide = (input: Record<string, unknown>) =>
    agentGateResult({
      ...input,
      ...(deps.protectedResource ? { protectedResource: deps.protectedResource } : {}),
    }) as {
      kind: 'not_agent' | 'rejected' | 'begin' | 'refused' | 'allowed'
      status: number
      challenge?: Record<string, string>
      log?: Record<string, unknown>
    }
  const headers = (challenge: Record<string, string> | undefined) =>
    challenge ? { challenge: new Headers(challenge) } : {}
  return async call => {
    const identity = await deps.agentLayer.identify(call.presentedKey)
    const first = decide({ identity })
    if (first.kind === 'not_agent' || identity.kind === 'not_agent') return { kind: 'not_agent' }
    if (identity.kind === 'rejected') {
      deps.log.info('call.rejected', {
        requestId: call.requestId,
        ...call.logFields,
        ...first.log,
      })
      return {
        kind: 'rejected',
        status: first.status as 401 | 403,
        reason: identity.reason,
        detail: identity.detail,
        ...headers(first.challenge),
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
      const refusal = decide({ identity, begun })
      return {
        kind: 'refused',
        status: refusal.status as RefusalStatus,
        refused: begun,
        agent: identity.agent,
        ...headers(refusal.challenge),
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
  const status = agentRefusalStatus(reason)
  if (status === null) throw new Error(`Refusal reason ${JSON.stringify(reason)} has no status`)
  return status as RefusalStatus
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
