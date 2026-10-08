import { Hono } from 'hono'
import type { AgentLayer } from '../agent-layer'
import type { Logger } from '../log'
import { presentedKey, type MerchantKeys } from '../merchant/merchant-keys'
import type { ProviderAccount } from '../merchant/opper-accounts'
import type { OpperUpstream } from '../upstream/opper'

const PREFIX = '/v3/compat'
/** The paid route. Everything else under the prefix is forwarded as is. */
const PAID_ROUTE = { method: 'POST', subpath: '/v1/messages' }

export interface CompatDeps {
  agentLayer: AgentLayer
  merchantKeys: MerchantKeys
  accounts: ProviderAccount
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

export function compatRoutes(deps: CompatDeps): Hono {
  const app = new Hono()

  app.all(`${PREFIX}/*`, async c => {
    const request = c.req.raw
    const requestId = crypto.randomUUID()
    const subpath = c.req.path.slice(PREFIX.length)
    const paid = request.method === PAID_ROUTE.method && subpath === PAID_ROUTE.subpath

    const presented = presentedKey(request)
    if (!presented) {
      // Nothing to authenticate, so Opper answers itself: its 401 for a missing
      // key, its 404 for an unknown path such as Claude Code's /api/hello probe.
      return forwardAndLog({ request, requestId, subpath, paid, runtimeKey: null, userRef: null })
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

    let account
    try {
      account = await deps.accounts.open(userRef)
    } catch (error) {
      deps.log.error('account.open_failed', { requestId, userRef, error: errorMessage(error) })
      return c.json(opperError('Upstream account unavailable. Try again shortly.'), 502)
    }

    return forwardAndLog({
      request,
      requestId,
      subpath,
      paid,
      runtimeKey: account.runtimeKey,
      userRef,
      agentRef,
      project: account.projectName,
    })
  })

  async function forwardAndLog(call: {
    request: Request
    requestId: string
    subpath: string
    paid: boolean
    runtimeKey: string | null
    userRef: string | null
    agentRef?: string | null
    project?: string
  }): Promise<Response> {
    const started = Date.now()
    const tags: Record<string, string> = { request_id: call.requestId }
    if (call.userRef) tags.clone_user = call.userRef
    if (call.agentRef) tags.agent_id = call.agentRef
    const { response, completion } = await deps.upstream.forward({
      request: call.request,
      subpath: call.subpath,
      runtimeKey: call.runtimeKey,
      tags,
    })

    completion
      .then(done =>
        deps.log.info(call.userRef ? 'call.completed' : 'call.anonymous', {
          requestId: call.requestId,
          userRef: call.userRef,
          auth: call.agentRef ? 'agent' : call.userRef ? 'merchant_key' : 'none',
          agentRef: call.agentRef ?? null,
          project: call.project ?? null,
          method: call.request.method,
          subpath: call.subpath,
          paid: call.paid,
          status: done.status,
          streamed: done.streamed,
          bytes: done.bytes,
          costUsd: done.cost.usd,
          costSource: done.cost.source,
          opperHeaders: done.opperHeaders,
          traceId: done.traceId,
          ms: Date.now() - started,
        }),
      )
      .catch(error =>
        deps.log.error('call.stream_failed', {
          requestId: call.requestId,
          userRef: call.userRef,
          error: errorMessage(error),
        }),
      )

    return response
  }

  return app
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
