import { Hono } from 'hono'
import type { Logger } from '../log'
import { presentedKey, type MerchantKeys } from '../merchant/merchant-keys'
import type { ProviderAccount } from '../merchant/opper-accounts'
import type { OpperUpstream } from '../upstream/opper'

const PREFIX = '/v3/compat'
/** The paid route. Everything else under the prefix is forwarded as is. */
const PAID_ROUTE = { method: 'POST', subpath: '/v1/messages' }

export interface CompatDeps {
  merchantKeys: MerchantKeys
  accounts: ProviderAccount
  upstream: OpperUpstream
  log: Logger
}

export function compatRoutes(deps: CompatDeps): Hono {
  const app = new Hono()

  app.all(`${PREFIX}/*`, async c => {
    const request = c.req.raw
    const requestId = crypto.randomUUID()
    const subpath = c.req.path.slice(PREFIX.length)
    const paid = request.method === PAID_ROUTE.method && subpath === PAID_ROUTE.subpath

    const presented = presentedKey(request)
    const userRef = presented ? deps.merchantKeys.resolve(presented) : null
    if (!userRef) {
      deps.log.info('call.rejected', { requestId, subpath, reason: 'unknown_key' })
      // Anthropic's error shape; S1 task 1.6 checks it against Opper's own body.
      return c.json(
        { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        401,
      )
    }

    let account
    try {
      account = await deps.accounts.open(userRef)
    } catch (error) {
      deps.log.error('account.open_failed', { requestId, userRef, error: errorMessage(error) })
      return c.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream account unavailable' } },
        502,
      )
    }

    const started = Date.now()
    const { response, completion } = await deps.upstream.forward({
      request,
      subpath,
      runtimeKey: account.runtimeKey,
      tags: { request_id: requestId, clone_user: userRef },
    })

    completion
      .then(done =>
        deps.log.info('call.completed', {
          requestId,
          userRef,
          project: account.projectName,
          method: request.method,
          subpath,
          paid,
          status: done.status,
          streamed: done.streamed,
          bytes: done.bytes,
          costUsd: done.cost.usd,
          costSource: done.cost.source,
          opperHeaders: done.opperHeaders,
          ms: Date.now() - started,
        }),
      )
      .catch(error =>
        deps.log.error('call.stream_failed', { requestId, userRef, error: errorMessage(error) }),
      )

    return response
  })

  return app
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
