// One agent's paid call, start to finish, whatever the protocol: an HTTP
// route and an MCP tool run it the same way, and each turns a refusal into
// its own wire format.
//
// SolvaPay decides everything (DEV-1126): `authorize` before the upstream
// call finds the customer, checks the spend policy, holds the estimate
// against the budget and the balance, and waits for the owner when they
// must approve; `complete` after it settles at the cost the upstream
// reported. This file only drives those two requests: what to do after each
// answer is decided by the Rust core (`agentCallStep`), as on every SDK.
import {
  AgentApiError,
  type AuthorizeInput,
  type CompleteInput,
  type CompleteResponse,
  type MoneyAmount,
  type ServerRefusalReason,
  type SolvaPayAgentClient,
} from './client'
import { agentAmountString, agentCallStep, agentCompleteBody } from './core'
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

/** What the core says a call does next. */
type Step =
  | { kind: 'authorize'; body: AuthorizeInput; deadlineMs: number }
  | { kind: 'sleep'; ms: number; deadlineMs: number; log: Record<string, unknown> }
  | {
      kind: 'allow'
      callRef: string
      reservation: { held: MoneyAmount; expiresAt: string }
    }
  | { kind: 'refused'; reason: RefusalReason; message: string; log: Record<string, unknown> }

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

  function allowed(call: AgentCall, answer: Extract<Step, { kind: 'allow' }>) {
    const { callRef } = answer
    let completed = false
    async function complete(body: CompleteInput) {
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
      finish: result => complete(agentCompleteBody(result) as CompleteInput),
      release: async reason => {
        await complete(agentCompleteBody({ release: reason }) as CompleteInput)
      },
    }
    return result
  }

  return {
    async begin(call) {
      // What the core needs of the call: no signal, no log fields.
      const subject = {
        requestId: call.requestId,
        agentToken: call.agentToken,
        agent: call.agent,
        item: call.item,
        estimate: call.estimate,
        prompt: call.prompt,
      }
      let deadlineMs: number | undefined
      let outcome:
        | { answer: unknown }
        | { failure: { status: number | null; error: string } }
        | null = null
      for (;;) {
        const step = agentCallStep({
          call: subject,
          maxWaitSeconds: deps.maxWaitSeconds,
          nowMs: now(),
          ...(deadlineMs === undefined ? {} : { deadlineMs }),
          ...(outcome ?? {}),
          aborted: call.signal.aborted,
        }) as Step

        if (step.kind === 'authorize') {
          deadlineMs = step.deadlineMs
          try {
            outcome = { answer: await client.authorize(step.body) }
          } catch (error) {
            const status = error instanceof AgentApiError ? error.status : null
            log.error('call.authorize_failed', {
              ...callFields(call),
              status,
              error: errorMessage(error),
            })
            outcome = { failure: { status, error: errorMessage(error) } }
          }
          continue
        }
        if (step.kind === 'sleep') {
          log.info('call.waiting', { ...callFields(call), ...step.log })
          await sleep(step.ms, call.signal)
          outcome = null
          continue
        }
        if (step.kind === 'allow') {
          log.info('call.allowed', { ...callFields(call), callRef: step.callRef })
          return allowed(call, step)
        }
        // A failed authorize was logged above with its status; the refusal carries the rest.
        const fields = 'failure' in (outcome ?? {}) ? {} : step.log
        log.info('call.refused', { ...callFields(call), reason: step.reason, ...fields })
        return { kind: 'refused', reason: step.reason, message: step.message }
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
  return agentAmountString(amount)
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
