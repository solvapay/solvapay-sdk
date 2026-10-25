import { Hono } from 'hono'
import {
  createAgentCalls,
  decisionFields,
  finishedFields,
  type AgentLayer,
  type Allowed,
  type ApprovalWait,
  type Metering,
  type Policy,
  type PromptFacts,
  type Refused,
  type VerifiedAgent,
} from '@solvapay/agent-layer'
import { agentErrors, estimateCall, lastUserTurn } from '../agent-layer'
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
  /** Holds a call SolvaPay asks about while its approval waits for the owner. */
  approvalWait: ApprovalWait
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

type ReadCall =
  | { ok: true; model: string; maxTokens?: number; prompt: PromptFacts | null }
  | { ok: false; message: string }

/** The fields the estimate needs from an Anthropic Messages body, and the last user turn. */
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
  const prompt = lastUserTurn(parsed)
  return typeof maxTokens === 'number' && Number.isInteger(maxTokens) && maxTokens > 0
    ? { ok: true, model, maxTokens, prompt }
    : { ok: true, model, prompt }
}

export function compatRoutes(deps: CompatDeps): Hono {
  const app = new Hono()
  const calls = createAgentCalls(deps)

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

    let metered: Allowed | null = null
    if (paid && identity.kind === 'agent') {
      const outcome = await meterAgentCall({
        request,
        body,
        requestId,
        subpath,
        agentToken: presented,
        agent: identity.agent,
      })
      // Not `instanceof Response`: @hono/node-server swaps the global Response, so a
      // Response.json() refusal is not an instance of it under the real server.
      if (outcome.kind !== 'allow') return outcome.response
      metered = outcome
    }
    let account
    try {
      account = await deps.accounts.open(userRef)
    } catch (error) {
      deps.log.error('account.open_failed', { requestId, userRef, error: errorMessage(error) })
      if (metered) await metered.release()
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
   * The body gives the estimate and the last user turn; the agent layer then
   * runs customer, spend policy and balance, holding while the owner decides.
   * Every refusal is an Anthropic-shaped error and never reaches Opper.
   */
  async function meterAgentCall(call: {
    request: Request
    body: ArrayBuffer | undefined
    requestId: string
    subpath: string
    agentToken: string
    agent: VerifiedAgent
  }): Promise<Allowed | { kind: 'refused'; response: Response }> {
    const { requestId } = call
    const read = readCall(call.body)
    if (!read.ok) {
      deps.log.info('call.refused', {
        requestId,
        subpath: call.subpath,
        userRef: call.agent.principalRef,
        agentRef: call.agent.agentRef,
        reason: 'bad_request',
        detail: read.message,
      })
      return { kind: 'refused', response: agentErrors.badRequest(read.message, requestId) }
    }
    const estimate = estimateCall({
      model: read.model,
      bodyBytes: call.body?.byteLength ?? 0,
      maxTokens: read.maxTokens,
    })
    const outcome = await calls.begin({
      request: call.request,
      requestId,
      agentToken: call.agentToken,
      agent: call.agent,
      item: estimate.model,
      estimateUsd: estimate.estimateUsd,
      prompt: read.prompt,
      signal: call.request.signal,
      logFields: { subpath: call.subpath },
    })
    return outcome.kind === 'allow'
      ? outcome
      : { kind: 'refused', response: refusalResponse(outcome, requestId) }
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
    metered?: Allowed | null
  }): Promise<Response> {
    const started = Date.now()
    const tags: Record<string, string> = { request_id: call.requestId }
    if (call.userRef) tags.clone_user = call.userRef
    if (call.agentRef) tags.agent_id = call.agentRef
    if (call.metered) tags.decision_id = call.metered.decided.decisionRef
    if (call.metered?.decided.policy) tags.policy_id = call.metered.decided.policy.reference
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
      if (call.metered) await call.metered.release()
      throw error
    }
    const { response, completion } = forwarded

    completion
      .then(async done => {
        const finished = call.metered
          ? await call.metered.finish({
              status: done.status,
              costUsd: done.cost.usd,
              ...(done.interrupted ? { interrupted: done.interrupted } : {}),
            })
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
          ...(call.metered ? decisionFields(call.metered.decided, call.metered) : {}),
          ...(finished ? finishedFields(finished) : {}),
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

  return app
}

/**
 * A refusal as the clone answers it: Opper's own 401 shape when SolvaPay did
 * not accept the agent, 502 when SolvaPay was unavailable, 422 for a deny so
 * Claude Code shows the reason once instead of retrying, otherwise 402.
 */
function refusalResponse(refused: Refused, requestId: string): Response {
  switch (refused.reason) {
    case 'agent_not_accepted':
      return Response.json(opperError(`invalid bearer token. ${refused.message}`), { status: 401 })
    case 'unavailable':
      return Response.json(opperError(refused.message), { status: 502 })
    case 'deny':
      return agentErrors.decisionError('deny', refused.message, requestId)
    default:
      return agentErrors.anthropicError(402, refused.message, requestId)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
