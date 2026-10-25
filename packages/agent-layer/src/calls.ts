// One agent's paid call, start to finish, whatever the protocol: an HTTP
// route and an MCP tool run it the same way, and each turns a refusal into
// its own wire format.
//
// Order (build plan §7e): customer, spend policy, balance. Permission before
// money, so a deny or ask wins over topup_required. When SolvaPay asks with a
// pending approval and holding is on, the call waits for the owner (DEV-1104)
// and is decided again once approved; one hold per call.
import type { ApprovalWait, WaitOutcome } from './approval-wait'
import { AgentApiError, type DecideApproval } from './client'
import type { VerifiedAgent } from './identity'
import type { CallResult, Metering, Opened, Settled } from './metering'
import type { Decided, Policy, PolicySettled } from './policy'
import type { PromptFacts } from './prompt'

/** One JSON line per event. Never pass keys or secrets in `fields`. */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

export interface AgentCall {
  /** The request the call came in on. The balance gate takes it; the customer comes from the agent. */
  request: Request
  /** The merchant's id for the call, also SolvaPay's idempotency key for the decision. */
  requestId: string
  /** The token as presented: SolvaPay verifies it again when it decides. */
  agentToken: string
  agent: VerifiedAgent
  /** The merchant's label for what is used (a model id, a tool name). */
  item: string
  /** What this call may cost, USD decimal string; also the provisional amount. */
  estimateUsd: string
  prompt: PromptFacts | null
  /** Ends a hold when the caller goes away. */
  signal: AbortSignal
  /** Added to every log line about this call, for example the route or the tool. */
  logFields?: Record<string, unknown>
}

/** Why a call was refused. `message` is the sentence for the human, in every case. */
export type RefusalReason =
  /** The agent's account has no customer at this merchant: nothing to bill. */
  | 'customer_not_linked'
  /** SolvaPay did not accept the agent on decide: revoked, or not for this merchant. */
  | 'agent_not_accepted'
  /** The spend policy asks the owner; no hold (off, or nothing pending). */
  | 'ask'
  | 'deny'
  /** The customer's balance is under this call's estimate. */
  | 'topup_required'
  | 'approval_declined'
  | 'approval_expired'
  /** The hold ended with the approval still waiting. */
  | 'approval_timed_out'
  | 'approval_client_closed'
  /** SolvaPay could not be reached or answered with an error; never let through. */
  | 'unavailable'

export interface Refused {
  kind: 'refused'
  reason: RefusalReason
  message: string
}

export interface Finished {
  /** `null` when the policy settle failed: logged, and the reservation expires at its estimate. */
  policySettled: PolicySettled | null
  /** `null` when the credit settle failed: logged; the caller already has its answer. */
  settled: Settled | null
}

export interface Allowed {
  kind: 'allow'
  decided: Extract<Decided, { action: 'allow' }>
  opened: Extract<Opened, { kind: 'allow' }>
  item: string
  estimateUsd: string
  /**
   * Settles the spend policy, then debits the credits, by the metering rules.
   * Policy first: spend counted but not debited is the safe failure. Once per call.
   */
  finish(result: CallResult): Promise<Finished>
  /** Drops the reservation: the call never reached the upstream. A failure is logged. */
  release(): Promise<void>
}

export interface AgentCalls {
  begin(call: AgentCall): Promise<Allowed | Refused>
}

/** SolvaPay asked with a pending approval: the call can wait for the owner's answer. */
interface Held {
  held: DecideApproval
  /** Why it asked: the policy's reason code, or the balance gate's `topup_required`. */
  reason: string
  /** What it said, for the human: SolvaPay's reason text, or the balance gate's message. */
  text: string
}

/**
 * SolvaPay's reason when the bank asked the owner to confirm the card for a
 * top-up: the approval is a card confirmation, not more budget, and its
 * reason text names the card and the merchant.
 */
const CARD_CONFIRMATION_REQUIRED = 'card_confirmation_required'

const NOT_LINKED =
  'This agent has no payment set up with this merchant. Connect it in SolvaPay, then retry.'
const NOT_ACCEPTED = 'SolvaPay did not accept this agent (revoked or not for this merchant).'
const POLICY_UNAVAILABLE = 'Spend policy check is unavailable. Try again shortly.'
const BILLING_UNAVAILABLE = 'Billing is unavailable. Try again shortly.'

export function createAgentCalls(deps: {
  metering: Metering
  policy: Policy
  /** Holds a call SolvaPay asks about while its approval waits for the owner. */
  approvalWait: ApprovalWait
  log: Logger
}): AgentCalls {
  const { log } = deps

  function logCall(
    event: 'call.refused' | 'call.held',
    call: AgentCall,
    reason: string,
    fields: Record<string, unknown>,
  ) {
    log.info(event, {
      requestId: call.requestId,
      ...call.logFields,
      userRef: call.agent.principalRef,
      agentRef: call.agent.agentRef,
      reason,
      ...fields,
    })
  }

  function refuse(
    call: AgentCall,
    reason: RefusalReason,
    message: string,
    logReason: string,
    fields: Record<string, unknown> = {},
  ): Refused {
    logCall('call.refused', call, logReason, fields)
    return { kind: 'refused', reason, message }
  }

  /** Off the reservation at once, so a refused call holds no budget. A failure is logged; the reservation then expires. */
  async function releaseDecision(decided: Allowed['decided'], requestId: string) {
    try {
      await decided.release()
    } catch (error) {
      log.error('call.release_failed', {
        requestId,
        decisionRef: decided.decisionRef,
        error: errorMessage(error),
      })
    }
  }

  async function meter(
    call: AgentCall,
    attempt: {
      /** SolvaPay's idempotency key: a repeat returns the first decision, so a retry needs its own. */
      decideRequestId: string
      /** Whether an ask with a pending approval may be held instead of refused. */
      canHold: boolean
    },
  ): Promise<Allowed | Refused | Held> {
    const { requestId } = call
    const estimate = { item: call.item, estimateUsd: call.estimateUsd }
    const held = (
      reason: string,
      text: string,
      fields: Record<string, unknown>,
      approval: DecideApproval,
    ): Held => {
      logCall('call.held', call, reason, { ...fields, approvalRef: approval.reference })
      return { held: approval, reason, text }
    }

    let customerRef: string | null
    try {
      customerRef = await deps.metering.customer(call.agent.principalRef)
    } catch (error) {
      log.error('call.metering_failed', { requestId, error: errorMessage(error) })
      return { kind: 'refused', reason: 'unavailable', message: BILLING_UNAVAILABLE }
    }
    if (!customerRef) {
      return refuse(call, 'customer_not_linked', NOT_LINKED, 'customer_not_linked', estimate)
    }

    let decided: Decided
    try {
      decided = await deps.policy.decide({
        agentToken: call.agentToken,
        requestId: attempt.decideRequestId,
        item: call.item,
        estimateUsd: call.estimateUsd,
        agentRef: call.agent.agentRef,
        prompt: call.prompt,
      })
    } catch (error) {
      log.error('call.decide_failed', {
        requestId,
        ...estimate,
        status: error instanceof AgentApiError ? error.status : null,
        error: errorMessage(error),
      })
      // SolvaPay verifies the token again: a revoked agent, or one for another merchant.
      if (error instanceof AgentApiError && (error.status === 401 || error.status === 403)) {
        return { kind: 'refused', reason: 'agent_not_accepted', message: NOT_ACCEPTED }
      }
      return { kind: 'refused', reason: 'unavailable', message: POLICY_UNAVAILABLE }
    }
    if (decided.action === 'ask' && attempt.canHold && decided.approval?.status === 'pending') {
      return held(
        decided.reasonCode,
        decided.reasonText,
        decisionFields(decided, estimate),
        decided.approval,
      )
    }
    if (decided.action !== 'allow') {
      return refuse(call, decided.action, decided.reasonText, decided.reasonCode, {
        ...decisionFields(decided, estimate),
        action: decided.action,
      })
    }

    let opened: Opened
    try {
      opened = await deps.metering.open({
        request: call.request,
        customerRef,
        estimateUsd: call.estimateUsd,
        // What the merchant's usage event says about the agent's call: the decision,
        // the agent and the spend policy. SolvaPay's statement and provider view read it.
        metadata: {
          decision_ref: decided.decisionRef,
          agent_id: call.agent.agentRef,
          ...(decided.policy ? { policy_id: decided.policy.reference } : {}),
        },
      })
    } catch (error) {
      log.error('call.metering_failed', { requestId, error: errorMessage(error) })
      await releaseDecision(decided, requestId)
      return { kind: 'refused', reason: 'unavailable', message: BILLING_UNAVAILABLE }
    }
    if (opened.kind === 'refused') {
      await releaseDecision(decided, requestId)
      if (attempt.canHold && decided.approval?.status === 'pending') {
        return held(
          opened.reason,
          opened.message,
          decisionFields(decided, estimate),
          decided.approval,
        )
      }
      return refuse(
        call,
        'topup_required',
        withApproval(opened.message, decided.approval),
        opened.reason,
        decisionFields(decided, estimate),
      )
    }

    return allowed(call, decided, opened)
  }

  function allowed(
    call: AgentCall,
    decided: Allowed['decided'],
    opened: Allowed['opened'],
  ): Allowed {
    const { requestId } = call
    return {
      kind: 'allow',
      decided,
      opened,
      item: call.item,
      estimateUsd: call.estimateUsd,
      async finish(result) {
        let policySettled: PolicySettled | null
        try {
          policySettled = await decided.settle(result)
        } catch (error) {
          log.error('call.policy_settle_failed', {
            requestId,
            decisionRef: decided.decisionRef,
            costUsd: result.costUsd,
            error: errorMessage(error),
          })
          policySettled = null
        }
        let settled: Settled | null
        try {
          settled = await opened.settle(result)
        } catch (error) {
          log.error('call.settle_failed', {
            requestId,
            customerRef: opened.customerRef,
            costUsd: result.costUsd,
            error: errorMessage(error),
          })
          settled = null
        }
        return { policySettled, settled }
      },
      release: () => releaseDecision(decided, requestId),
    }
  }

  /**
   * Waits for the owner to answer the approval SolvaPay asked with, then
   * decides the call again. An approved call goes on like any allowed one; a
   * declined, expired or unanswered one is refused saying which. A second ask
   * is refused as SolvaPay put it: one hold per call.
   */
  async function holdForOwner(held: Held, call: AgentCall): Promise<Allowed | Refused> {
    const { requestId } = call
    const approvalRef = held.held.reference
    let waited
    try {
      waited = await deps.approvalWait.until(held.held, call.signal)
    } catch (error) {
      log.error('call.approval_wait_failed', {
        requestId,
        approvalRef,
        status: error instanceof AgentApiError ? error.status : null,
        error: errorMessage(error),
      })
      return { kind: 'refused', reason: 'unavailable', message: POLICY_UNAVAILABLE }
    }
    log.info('call.approval_wait', { requestId, approvalRef, ...waited })
    if (waited.outcome !== 'approved') {
      const message =
        held.reason === CARD_CONFIRMATION_REQUIRED
          ? afterCardConfirmationWait(approvalRef, waited.outcome, held.text)
          : afterWait(approvalRef, waited.outcome)
      return refuse(call, `approval_${waited.outcome}`, message, `approval_${waited.outcome}`, {
        approvalRef,
        held: held.reason,
      })
    }
    const again = await meter(call, {
      decideRequestId: `${requestId}:after-${approvalRef}`,
      canHold: false,
    })
    if ('held' in again) throw new Error('A retry that cannot hold returned a hold')
    return again
  }

  return {
    async begin(call) {
      const first = await meter(call, {
        decideRequestId: call.requestId,
        canHold: deps.approvalWait.maxMs > 0,
      })
      return 'held' in first ? holdForOwner(first, call) : first
    },
  }
}

/** The decision, for a log line about the call. */
export function decisionFields(
  decided: Decided,
  estimate: { item: string; estimateUsd: string },
): Record<string, unknown> {
  return {
    decisionRef: decided.decisionRef,
    reasonCode: decided.reasonCode,
    policyRef: decided.policy?.reference ?? null,
    policyVersion: decided.policy?.version ?? null,
    item: estimate.item,
    estimateUsd: estimate.estimateUsd,
    decideMs: decided.decideMs,
    promptHash8: decided.promptHash8,
    excerptSent: decided.excerptSent,
    ...(decided.budget ? { budget: decided.budget } : {}),
  }
}

/** How a finished call settled, for its log line. */
export function finishedFields(finished: Finished): Record<string, unknown> {
  return { ...policySettleFields(finished.policySettled), ...settleFields(finished.settled) }
}

function policySettleFields(settled: PolicySettled | null): Record<string, unknown> {
  if (!settled) return { policySettled: false }
  return {
    policySettled: true,
    policySource: settled.source,
    spentPeriodUsd: settled.response.policy.spentPeriodUsd,
    reservedUsd: settled.response.policy.reservedUsd,
    ...(settled.response.flags.length > 0 ? { policyFlags: settled.response.flags } : {}),
  }
}

function settleFields(settled: Settled | null): Record<string, unknown> {
  if (!settled) return { settled: false, settleError: true }
  if (!settled.settled) return { settled: false, settleSkipped: settled.reason }
  const { debit } = settled
  return {
    settled: true,
    settleSource: settled.source,
    amountUsd: settled.amountUsd,
    debited: debit.debited,
    ...(debit.debited
      ? {
          creditsDebited: debit.amount,
          balanceUsd: debit.balanceUsd,
          balanceCredits: debit.balanceCredits,
        }
      : { debitSkipped: debit.reason }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What the human reads when a held call is refused: how the owner's approval ended. */
function afterWait(approvalRef: string, outcome: Exclude<WaitOutcome, 'approved'>): string {
  switch (outcome) {
    case 'declined':
      return `Your owner declined approval ${approvalRef} for more budget this month.`
    case 'expired':
      return `Approval ${approvalRef} for more budget expired before your owner answered. Retry to ask again.`
    case 'timed_out':
      return `Approval ${approvalRef} for more budget is still waiting for your owner. Retry once they answer.`
    case 'client_closed':
      return `The request closed while approval ${approvalRef} was waiting for your owner.`
  }
}

/**
 * How a hold on a card confirmation ended without it: SolvaPay's own text,
 * which names the card and the merchant, while nobody has answered; the
 * owner's no when they declined.
 */
function afterCardConfirmationWait(
  approvalRef: string,
  outcome: Exclude<WaitOutcome, 'approved'>,
  text: string,
): string {
  if (outcome === 'declined') {
    return `Your owner declined to confirm the card (request ${approvalRef}), so this agent cannot buy more credit here.`
  }
  return text
}

/**
 * The SDK's balance text, plus what SolvaPay said about the month's approval:
 * the human then knows a request is with the owner, or was declined.
 */
function withApproval(message: string, approval: Decided['approval']): string {
  if (approval?.status === 'pending') {
    return `${message} Approval ${approval.reference} for more budget is waiting for your owner.`
  }
  if (approval?.status === 'declined') {
    return `${message} Your owner declined more budget this month.`
  }
  return message
}
