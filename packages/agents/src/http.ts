// `@solvapay/agents/http`: SolvaPay agent payments for an HTTP API. The gate
// reads the presented key: a SolvaPay agent token is verified and the call
// authorized; anything else is left to the merchant's own auth. The merchant
// forwards an allowed call, then completes it with the cost the upstream
// reported (`allowed.finish`), or releases it when the upstream was never
// reached (`allowed.release`). Framework-neutral: Request in, plain results out.
import { SolvaPayError } from '@solvapay/core'
import type { MoneyAmount } from './client'
import type { AgentCalls, Allowed, Logger, RefusalReason, Refused } from './calls'
import type { AgentLayer, AgentRejectionReason, VerifiedAgent } from './identity'
import { isAgentKey } from './identity'
import {
  MPP_AGENT_KEY_HEADER,
  MPP_CHALLENGE_HEADER,
  MPP_RECEIPT_HEADER,
  encodeMppReceipt,
  type SolvaPayMppClient,
} from './mpp'
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
  | {
      kind: 'allowed'
      allowed: Allowed
      agent: VerifiedAgent
      /**
       * Set when this request paid with MPP: the headers to add to the paid
       * response (`Payment-Receipt`, and the new payer's `SolvaPay-Agent-Key`).
       */
      paid?: Headers
    }
  /**
   * MPP is on and this call must be paid first: answer 402 with `headers`
   * (`WWW-Authenticate`). `refused` says why when the agent had a key (an MPP
   * payer short of balance); `problem` when a credential it sent did not pay.
   */
  | {
      kind: 'mpp_challenge'
      status: 402
      headers: Headers
      refused?: Refused
      problem?: { type?: string; title?: string; detail?: string }
    }

/** MPP on a merchant's gate (preview): agents with no SolvaPay key pay with MPP. */
export interface MppGateOptions {
  client: SolvaPayMppClient
  /** The merchant's host as agents call it, which MPP challenges are bound to. */
  realm: string
}

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
  /** The MPP credential the request carries (`mppCredentialOf(request.headers)`), if any. */
  mppCredential?: string | null
}

export function createAgentHttpGate(deps: {
  agentLayer: AgentLayer
  calls: AgentCalls
  log: Logger
  /** Turns the OAuth challenge on: 401 results carry the headers that send a host to sign in. */
  protectedResource?: ProtectedResource
  /** Turns MPP on: a call with no SolvaPay key gets a 402 it can pay with MPP. */
  mpp?: MppGateOptions
}): (call: GateCall) => Promise<GateResult> {
  const challenge = (description: string) =>
    deps.protectedResource
      ? { challenge: challengeHeaders(deps.protectedResource, description) }
      : {}
  const mpp = deps.mpp
  async function mppChallenge(
    agentKey: string | undefined,
    why: { refused?: Refused; problem?: { type?: string; title?: string; detail?: string } } = {},
  ): Promise<GateResult> {
    if (!mpp) throw new Error('MPP challenge asked for with MPP off')
    const { wwwAuthenticate } = await mpp.client.challenge({
      realm: mpp.realm,
      ...(agentKey ? { agentKey } : {}),
    })
    return {
      kind: 'mpp_challenge',
      status: 402,
      headers: challengeHeadersOf(wwwAuthenticate),
      ...why,
    }
  }

  /** The agent paid with MPP: SolvaPay checks it, then the call goes ahead on the payer's key. */
  async function payWithMpp(call: GateCall, credential: string): Promise<GateResult> {
    if (!mpp) throw new Error('MPP credential seen with MPP off')
    const presented = isAgentKey(call.presentedKey) ? call.presentedKey : undefined
    const paid = await mpp.client.credential({
      realm: mpp.realm,
      authorization: credential,
      ...(presented ? { agentKey: presented } : {}),
    })
    if (paid.status === 'refused') {
      deps.log.info('call.mpp_refused', {
        requestId: call.requestId,
        ...call.logFields,
        ...paid.problem,
      })
      return {
        kind: 'mpp_challenge',
        status: 402,
        headers: challengeHeadersOf(paid.wwwAuthenticate),
        problem: paid.problem,
      }
    }
    const agentKey = paid.agentKey ?? presented
    if (!agentKey)
      throw new Error(`MPP payment ${paid.lot.reference} came with no key for its payer`)
    deps.log.info('call.mpp_paid', {
      requestId: call.requestId,
      ...call.logFields,
      agentRef: paid.agentRef,
      lotRef: paid.lot.reference,
      newPayer: paid.agentKey !== undefined,
    })
    const result = await gate({ ...call, presentedKey: agentKey, mppCredential: null })
    if (result.kind !== 'allowed') return result
    const headers = new Headers({
      [MPP_RECEIPT_HEADER]: encodeMppReceipt(paid.receipt, result.allowed.callRef),
    })
    if (paid.agentKey) headers.set(MPP_AGENT_KEY_HEADER, paid.agentKey)
    return { ...result, paid: headers }
  }

  async function gate(call: GateCall): Promise<GateResult> {
    if (mpp && call.mppCredential) return payWithMpp(call, call.mppCredential)
    const identity = await deps.agentLayer.identify(call.presentedKey)
    if (identity.kind === 'not_agent') {
      // No key at all: an agent that can pay with MPP. A key that is not SolvaPay's
      // stays with the merchant's own auth.
      return mpp && call.presentedKey === '' ? mppChallenge(undefined) : { kind: 'not_agent' }
    }
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
      // An MPP payer has no owner to top it up: it pays again.
      if (mpp && begun.reason === 'topup_required' && identity.agent.payer === 'mpp') {
        return mppChallenge(call.presentedKey, { refused: begun })
      }
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
  return gate
}

function challengeHeadersOf(wwwAuthenticate: string[]): Headers {
  const headers = new Headers()
  for (const value of wwwAuthenticate) headers.append(MPP_CHALLENGE_HEADER, value)
  return headers
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
      throw new SolvaPayError(`Refusal reason ${JSON.stringify(unknown)} has no status`, {
        code: 'unknown_refusal_reason',
      })
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

export {
  MPP_AGENT_KEY_HEADER,
  MPP_CHALLENGE_HEADER,
  MPP_PAYMENT_AUTHORIZATION_HEADER,
  MPP_RECEIPT_HEADER,
  createSolvaPayMppClient,
  encodeMppReceipt,
  mppCredentialOf,
  type MppCredentialResult,
  type MppReceipt,
  type SolvaPayMppClient,
} from './mpp'
