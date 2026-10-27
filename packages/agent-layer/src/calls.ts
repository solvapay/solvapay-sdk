// One agent's paid call, start to finish, whatever the protocol: an HTTP
// route and an MCP tool run it the same way, and each turns a refusal into
// its own wire format.
//
// SolvaPay decides everything (DEV-1126): `authorize` before the upstream
// call finds the customer, checks the spend policy, holds the estimate
// against the budget and the balance, and waits for the owner when they
// must approve; `complete` after it settles at the cost the upstream
// reported. This file only drives those two requests.
import {
  AUTHORIZE_WAIT_MAX_SECONDS,
  AgentApiError,
  type AuthorizeResponse,
  type CompleteResponse,
  type MoneyAmount,
  type ServerRefusalReason,
  type SolvaPayAgentClient,
} from './client'
import type { VerifiedAgent } from './identity'
import type { PromptFacts } from './prompt'

/** One JSON line per event. Never pass keys or secrets in `fields`. */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export interface AgentCall {
  /** The merchant's id for the call; SolvaPay keys the call on it. */
  requestId: string
  /** The token as presented: SolvaPay verifies it again. */
  agentToken: string
  agent: VerifiedAgent
  /** The merchant's label for what is used (a model id, a tool name). */
  item: string
  /** What this call may cost, in the merchant's currency. */
  estimate: MoneyAmount
  prompt: PromptFacts | null
  /** Ends a wait for the owner when the caller goes away. */
  signal: AbortSignal
  /** Added to every log line about this call, for example the route or the tool. */
  logFields?: Record<string, unknown>
}

/** Why a call was refused. `message` is the sentence for the human, in every case. */
export type RefusalReason =
  /** SolvaPay's own refusals, with its sentence. */
  | ServerRefusalReason
  /** SolvaPay did not accept the agent token: revoked, or not for this merchant. */
  | 'agent_not_accepted'
  /** The owner had not answered when this merchant stopped waiting. */
  | 'approval_timed_out'
  /** The caller went away while the owner was deciding. */
  | 'approval_client_closed'
  /** SolvaPay could not be reached or answered with an error; never let through. */
  | 'unavailable'

export interface Refused {
  kind: 'refused'
  reason: RefusalReason
  message: string
}

/** How the upstream answered, as the merchant read it. */
export interface CallResult {
  status: number
  /** The cost the upstream reported, in its currency, or null when none arrived. */
  cost: { amount: number; currency: string } | null
  /** Set when the answer to the caller broke before it finished. */
  interrupted?: string
}

export interface Allowed {
  kind: 'allow'
  /** SolvaPay's reference for the call: tag the upstream usage with it, and report usage by it. */
  callRef: string
  item: string
  estimate: MoneyAmount
  /** What SolvaPay holds for the call, in USD credits, until `expiresAt`. */
  reservation: { held: MoneyAmount; expiresAt: string }
  /**
   * Completes the call at how the upstream answered. Once per call. `null`
   * when SolvaPay could not be told: logged, and the call's reservations
   * lapse at the estimate.
   */
  finish(result: CallResult): Promise<CompleteResponse | null>
  /** The call never reached the upstream: completed as an upstream failure, so nothing is charged. */
  release(reason: string): Promise<void>
}

export interface AgentCalls {
  begin(call: AgentCall): Promise<Allowed | Refused>
}

const NOT_ACCEPTED = 'SolvaPay did not accept this agent (revoked or not for this merchant).'
const UNAVAILABLE = 'SolvaPay could not be reached to authorize this call. Try again shortly.'

export function createAgentCalls(deps: {
  client: Pick<SolvaPayAgentClient, 'authorize' | 'complete'>
  /** How long a call may wait for its owner's answer, in seconds; 0 refuses at once. */
  maxWaitSeconds: number
  log: Logger
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}): AgentCalls {
  const { client, log } = deps
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? abortableSleep

  function refuse(call: AgentCall, reason: RefusalReason, message: string, fields = {}): Refused {
    log.info('call.refused', { ...callFields(call), reason, ...fields })
    return { kind: 'refused', reason, message }
  }

  function allowed(call: AgentCall, answer: Extract<AuthorizeResponse, { status: 'allowed' }>) {
    const { callRef } = answer
    let completed = false
    async function complete(body: Parameters<SolvaPayAgentClient['complete']>[1]) {
      if (completed) throw new Error(`Call ${callRef} was already completed`)
      completed = true
      try {
        return await client.complete(callRef, body)
      } catch (error) {
        log.error('call.complete_failed', {
          ...callFields(call),
          callRef,
          status: error instanceof AgentApiError ? error.status : null,
          error: errorMessage(error),
        })
        return null
      }
    }
    const result: Allowed = {
      kind: 'allow',
      callRef,
      item: call.item,
      estimate: call.estimate,
      reservation: answer.reservation,
      finish: result =>
        complete({
          status: result.status,
          cost:
            result.cost === null
              ? null
              : { amount: amountString(result.cost.amount), currency: result.cost.currency },
          ...(result.interrupted ? { interrupted: result.interrupted } : {}),
        }),
      release: async reason => {
        await complete({ status: 502, cost: null, interrupted: reason })
      },
    }
    return result
  }

  return {
    async begin(call) {
      const deadline = now() + deps.maxWaitSeconds * 1000
      const facts = call.prompt
      for (;;) {
        const wait = Math.max(
          0,
          Math.min(AUTHORIZE_WAIT_MAX_SECONDS, Math.floor((deadline - now()) / 1000)),
        )
        let answer: AuthorizeResponse
        try {
          answer = await client.authorize({
            agentToken: call.agentToken,
            requestId: call.requestId,
            item: call.item,
            estimate: call.estimate,
            ...(facts
              ? {
                  promptHash: facts.promptHash,
                  toolError: facts.toolError,
                  // Only when the token SolvaPay minted says the owner opted in.
                  ...(call.agent.promptExcerpt ? { promptExcerpt: facts.excerpt } : {}),
                }
              : {}),
            wait,
          })
        } catch (error) {
          const status = error instanceof AgentApiError ? error.status : null
          log.error('call.authorize_failed', {
            ...callFields(call),
            status,
            error: errorMessage(error),
          })
          // SolvaPay verifies the token again: a revoked agent, or one for another merchant.
          if (status === 401 || status === 403)
            return refuse(call, 'agent_not_accepted', NOT_ACCEPTED)
          return refuse(call, 'unavailable', UNAVAILABLE)
        }

        if (answer.status === 'allowed') {
          log.info('call.allowed', { ...callFields(call), callRef: answer.callRef })
          return allowed(call, answer)
        }
        if (answer.status === 'refused') {
          return refuse(call, answer.reason, answer.message, { callRef: answer.callRef })
        }
        const held = { callRef: answer.callRef, approvalRef: answer.approval.reference }
        if (deps.maxWaitSeconds === 0) return refuse(call, 'ask', answer.message, held)
        if (call.signal.aborted) {
          return refuse(call, 'approval_client_closed', answer.message, held)
        }
        if (now() >= deadline) return refuse(call, 'approval_timed_out', answer.message, held)
        log.info('call.waiting', { ...callFields(call), ...held })
        await sleep(answer.retryAfterSeconds * 1000, call.signal)
      }
    },
  }
}

function callFields(call: AgentCall): Record<string, unknown> {
  return {
    requestId: call.requestId,
    ...call.logFields,
    agentRef: call.agent.agentRef,
    userRef: call.agent.principalRef,
    item: call.item,
    estimate: `${call.estimate.amount} ${call.estimate.currency}`,
  }
}

/** An amount as a decimal string with up to 8 places, trailing zeros trimmed. */
export function amountString(amount: number): string {
  const fixed = amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
  return fixed === '' ? '0' : fixed
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolves after `ms`, or at once when the caller goes away. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}
