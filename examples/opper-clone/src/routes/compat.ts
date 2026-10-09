import { Hono } from 'hono'
import {
  agentErrors,
  estimateCall,
  type AgentLayer,
  type Decided,
  type Estimate,
  type Policy,
  type PolicySettled,
} from '../agent-layer'
import { AgentApiError } from '../agent-layer/client'
import type { Metering, Opened, Settled } from '../agent-layer/metering'
import { isRecord } from '../lib/guards'
import type { Logger } from '../log'
import { presentedKey, type MerchantKeys } from '../merchant/merchant-keys'
import type { ProviderAccount } from '../merchant/opper-accounts'
import type { Completion, OpperUpstream } from '../upstream/opper'

const PREFIX = '/v3/compat'
/** The paid route. Everything else under the prefix is forwarded as is. */
const PAID_ROUTE = { method: 'POST', subpath: '/v1/messages' }

export interface CompatDeps {
  agentLayer: AgentLayer
  merchantKeys: MerchantKeys
  accounts: ProviderAccount
  /** Bills an agent's paid calls. Calls made with the merchant's own keys stay unbilled. */
  metering: Metering
  /** Decides an agent's paid calls against its spend policy, before the balance gate. */
  policy: Policy
  upstream: OpperUpstream
  log: Logger
}

/**
 * Opper's own 401 body on /v3/compat is `{"error": "<text>", ...}`, not
 * Anthropic's shape (fidelity check, 8 Oct 2026). The clone answers an unknown
 * key the same way, without Opper's sign-up links.
 */
function opperError(message: string) {
  return { error: message }
}

/** An agent's paid call that SolvaPay allowed: the reservation, the balance gate and the estimate. */
interface MeteredCall {
  decided: Extract<Decided, { action: 'allow' }>
  opened: Extract<Opened, { kind: 'allow' }>
  estimate: Estimate
}

type ReadCall = { ok: true; model: string; maxTokens?: number } | { ok: false; message: string }

/** The two fields the estimate needs from an Anthropic Messages body. */
export function readCall(body: ArrayBuffer | undefined): ReadCall {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body ?? new ArrayBuffer(0)))
  } catch {
    return { ok: false, message: 'The request body is not valid JSON.' }
  }
  if (!isRecord(parsed)) return { ok: false, message: 'The request body must be a JSON object.' }
  const { model, max_tokens: maxTokens } = parsed
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, message: 'model: Field required' }
  }
  return typeof maxTokens === 'number' && Number.isInteger(maxTokens) && maxTokens > 0
    ? { ok: true, model, maxTokens }
    : { ok: true, model }
}

export function compatRoutes(deps: CompatDeps): Hono {
  const app = new Hono()

  app.all(`${PREFIX}/*`, async c => {
    const request = c.req.raw
    const requestId = crypto.randomUUID()
    const subpath = c.req.path.slice(PREFIX.length)
    const paid = request.method === PAID_ROUTE.method && subpath === PAID_ROUTE.subpath
    // Read once: the policy needs the model and size, the upstream the bytes.
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer()

    const presented = presentedKey(request)
    if (!presented) {
      // Nothing to authenticate, so Opper answers itself: its 401 for a missing
      // key, its 404 for an unknown path such as Claude Code's /api/hello probe.
      return forwardAndLog({
        request,
        body,
        requestId,
        subpath,
        paid,
        runtimeKey: null,
        userRef: null,
      })
    }

    // A SolvaPay agent token takes precedence; anything else is the merchant's own key.
    const identity = await deps.agentLayer.identify(presented)
    if (identity.kind === 'rejected') {
      deps.log.info('call.rejected', {
        requestId,
        subpath,
        reason: `agent_token_${identity.reason}`,
        detail: identity.detail,
      })
      return c.json(
        opperError(`invalid bearer token. The agent token was not accepted (${identity.reason}).`),
        401,
      )
    }

    const agentRef = identity.kind === 'agent' ? identity.agent.agentRef : null
    const tokenId = identity.kind === 'agent' ? identity.agent.tokenId : null
    const userRef =
      identity.kind === 'agent' ? identity.agent.principalRef : deps.merchantKeys.resolve(presented)
    if (!userRef) {
      deps.log.info('call.rejected', { requestId, subpath, reason: 'unknown_key' })
      return c.json(
        opperError(
          'invalid bearer token. The key was not recognised; check it, or mint a new one.',
        ),
        401,
      )
    }

    let metered: MeteredCall | null = null
    if (paid && identity.kind === 'agent') {
      const outcome = await meterAgentCall({
        request,
        body,
        requestId,
        subpath,
        agentToken: presented,
        principalRef: userRef,
        agentRef: identity.agent.agentRef,
      })
      // Not `instanceof Response`: @hono/node-server swaps the global Response, so a
      // Response.json() refusal is not an instance of it under the real server.
      if (!('decided' in outcome)) return outcome
      metered = outcome
    }
    let account
    try {
      account = await deps.accounts.open(userRef)
    } catch (error) {
      deps.log.error('account.open_failed', { requestId, userRef, error: errorMessage(error) })
      if (metered) await release(metered, requestId)
      return c.json(opperError('Upstream account unavailable. Try again shortly.'), 502)
    }

    return forwardAndLog({
      request,
      body,
      requestId,
      subpath,
      paid,
      runtimeKey: account.runtimeKey,
      userRef,
      agentRef,
      tokenId,
      project: account.projectName,
      metered,
    })
  })

  /**
   * Order (build plan §7e): body, estimate, customer, spend policy, balance.
   * Permission before money, so a deny or ask wins over topup_required. Every
   * refusal is an Anthropic-shaped error and never reaches Opper.
   */
  async function meterAgentCall(call: {
    request: Request
    body: ArrayBuffer | undefined
    requestId: string
    subpath: string
    agentToken: string
    principalRef: string
    agentRef: string
  }): Promise<MeteredCall | Response> {
    const { requestId } = call
    const refused = (reason: string, fields: Record<string, unknown> = {}) =>
      deps.log.info('call.refused', {
        requestId,
        subpath: call.subpath,
        userRef: call.principalRef,
        agentRef: call.agentRef,
        reason,
        ...fields,
      })

    const read = readCall(call.body)
    if (!read.ok) {
      refused('bad_request', { detail: read.message })
      return agentErrors.badRequest(read.message, requestId)
    }
    const estimate = estimateCall({
      model: read.model,
      bodyBytes: call.body?.byteLength ?? 0,
      maxTokens: read.maxTokens,
    })
    const estimateFields = {
      model: estimate.model,
      tier: estimate.tier,
      estimateUsd: estimate.estimateUsd,
    }

    let customerRef: string | null
    try {
      customerRef = await deps.metering.customer(call.principalRef)
    } catch (error) {
      deps.log.error('call.metering_failed', { requestId, error: errorMessage(error) })
      return Response.json(opperError('Billing is unavailable. Try again shortly.'), {
        status: 502,
      })
    }
    if (!customerRef) {
      refused('customer_not_linked', estimateFields)
      return agentErrors.customerNotLinked(requestId)
    }

    let decided: Decided
    try {
      decided = await deps.policy.decide({
        agentToken: call.agentToken,
        requestId,
        model: estimate.model,
        tier: estimate.tier,
        estimateUsd: estimate.estimateUsd,
      })
    } catch (error) {
      deps.log.error('call.decide_failed', {
        requestId,
        ...estimateFields,
        status: error instanceof AgentApiError ? error.status : null,
        error: errorMessage(error),
      })
      // SolvaPay verifies the token again: a revoked agent, or one for another merchant.
      if (error instanceof AgentApiError && (error.status === 401 || error.status === 403)) {
        return Response.json(
          opperError(
            'invalid bearer token. SolvaPay did not accept this agent (revoked or not for this merchant).',
          ),
          { status: 401 },
        )
      }
      return Response.json(opperError('Spend policy check is unavailable. Try again shortly.'), {
        status: 502,
      })
    }
    if (decided.action !== 'allow') {
      refused(decided.reasonCode, { ...decisionFields(decided, estimate), action: decided.action })
      return agentErrors.decisionError(decided.action, decided.reasonText, requestId)
    }

    let opened: Opened
    try {
      opened = await deps.metering.open({
        request: call.request,
        customerRef,
        estimateUsd: estimate.estimateUsd,
        metadata: { decision_ref: decided.decisionRef },
      })
    } catch (error) {
      deps.log.error('call.metering_failed', { requestId, error: errorMessage(error) })
      await releaseDecision(decided, requestId)
      return Response.json(opperError('Billing is unavailable. Try again shortly.'), {
        status: 502,
      })
    }
    if (opened.kind === 'refused') {
      await releaseDecision(decided, requestId)
      refused(opened.reason, decisionFields(decided, estimate))
      return agentErrors.topupRequired(withApproval(opened.message, decided.approval), requestId)
    }

    return { decided, opened, estimate }
  }

  /** Off the reservation at once, so a refused call holds no budget. A failure is logged; the reservation then expires. */
  async function releaseDecision(decided: MeteredCall['decided'], requestId: string) {
    try {
      await decided.release()
    } catch (error) {
      deps.log.error('call.release_failed', {
        requestId,
        decisionRef: decided.decisionRef,
        error: errorMessage(error),
      })
    }
  }

  function release(metered: MeteredCall, requestId: string) {
    return releaseDecision(metered.decided, requestId)
  }

  async function forwardAndLog(call: {
    request: Request
    body: ArrayBuffer | undefined
    requestId: string
    subpath: string
    paid: boolean
    runtimeKey: string | null
    userRef: string | null
    agentRef?: string | null
    tokenId?: string | null
    project?: string
    metered?: MeteredCall | null
  }): Promise<Response> {
    const started = Date.now()
    const tags: Record<string, string> = { request_id: call.requestId }
    if (call.userRef) tags.clone_user = call.userRef
    if (call.agentRef) tags.agent_id = call.agentRef
    if (call.metered) tags.decision_id = call.metered.decided.decisionRef
    let forwarded
    try {
      forwarded = await deps.upstream.forward({
        request: call.request,
        body: call.body,
        subpath: call.subpath,
        runtimeKey: call.runtimeKey,
        tags,
      })
    } catch (error) {
      if (call.metered) await release(call.metered, call.requestId)
      throw error
    }
    const { response, completion } = forwarded

    completion
      .then(async done => {
        // Policy first: spend counted but not debited is the safe failure.
        const policySettled = call.metered
          ? await settlePolicy(call.metered, done, call.requestId)
          : undefined
        const settled = call.metered
          ? await settle(call.metered.opened, done, call.requestId)
          : undefined
        deps.log.info(call.userRef ? 'call.completed' : 'call.anonymous', {
          requestId: call.requestId,
          userRef: call.userRef,
          auth: call.agentRef ? 'agent' : call.userRef ? 'merchant_key' : 'none',
          agentRef: call.agentRef ?? null,
          tokenId: call.tokenId ?? null,
          project: call.project ?? null,
          method: call.request.method,
          subpath: call.subpath,
          paid: call.paid,
          status: done.status,
          streamed: done.streamed,
          bytes: done.bytes,
          costUsd: done.cost.usd,
          costSource: done.cost.source,
          ...(done.interrupted ? { interrupted: done.interrupted } : {}),
          ...(call.metered ? decisionFields(call.metered.decided, call.metered.estimate) : {}),
          ...(policySettled !== undefined ? policySettleFields(policySettled) : {}),
          ...(settled !== undefined ? settleFields(settled) : {}),
          opperHeaders: done.opperHeaders,
          traceId: done.traceId,
          ms: Date.now() - started,
        })
      })
      .catch(error =>
        deps.log.error('call.log_failed', {
          requestId: call.requestId,
          userRef: call.userRef,
          error: errorMessage(error),
        }),
      )

    return response
  }

  /** A failed policy settle is logged; the reservation then expires and is counted at its estimate. */
  async function settlePolicy(
    metered: MeteredCall,
    done: Completion,
    requestId: string,
  ): Promise<PolicySettled | null> {
    try {
      return await metered.decided.settle({
        status: done.status,
        costUsd: done.cost.usd,
        ...(done.interrupted ? { interrupted: done.interrupted } : {}),
      })
    } catch (error) {
      deps.log.error('call.policy_settle_failed', {
        requestId,
        decisionRef: metered.decided.decisionRef,
        costUsd: done.cost.usd,
        error: errorMessage(error),
      })
      return null
    }
  }

  /** A failed settle is logged and the call goes on: the caller already has its answer. */
  async function settle(
    metered: Extract<Opened, { kind: 'allow' }>,
    done: Completion,
    requestId: string,
  ): Promise<Settled | null> {
    try {
      return await metered.settle({
        status: done.status,
        costUsd: done.cost.usd,
        ...(done.interrupted ? { interrupted: done.interrupted } : {}),
      })
    } catch (error) {
      deps.log.error('call.settle_failed', {
        requestId,
        customerRef: metered.customerRef,
        costUsd: done.cost.usd,
        error: errorMessage(error),
      })
      return null
    }
  }

  return app
}

function decisionFields(decided: Decided, estimate: Estimate): Record<string, unknown> {
  return {
    decisionRef: decided.decisionRef,
    reasonCode: decided.reasonCode,
    policyRef: decided.policy?.reference ?? null,
    policyVersion: decided.policy?.version ?? null,
    model: estimate.model,
    tier: estimate.tier,
    estimateUsd: estimate.estimateUsd,
    ...(decided.budget ? { budget: decided.budget } : {}),
  }
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

/**
 * The SDK's balance text, plus what SolvaPay said about the month's approval:
 * the human then knows a request is with the owner, or was declined. The
 * agent itself never sees it (the turn ends on a 402).
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
