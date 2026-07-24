import type { ExecutionContext } from '@cloudflare/workers-types'
import {
  activatePlanCore,
  cancelPurchaseCore,
  checkLimitsCore,
  checkPurchaseCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  getCustomerBalanceCore,
  getMerchantCore,
  getPaymentMethodCore,
  getProductCore,
  isErrorResult,
  listPlansCore,
  processPaymentIntentCore,
  processTopupPaymentIntentCore,
  reactivatePurchaseCore,
  type SolvaPay,
} from '@solvapay/server'
import { handleChat } from './chat'

/**
 * Runtime-agnostic API dispatcher for the chat-checkout demo. Both the
 * Vite dev plugin (Node runtime) and the Cloudflare Worker (V8 isolate)
 * call into this. Every dependency is passed explicitly so the helpers
 * never have to read `process.env` — that's what keeps this Workers-safe.
 */
export interface ApiDeps {
  solvaPay: SolvaPay
  geminiApiKey: string
}

type Handler = (request: Request, deps: ApiDeps) => Promise<unknown>

const HANDLERS: Record<string, { method: 'GET' | 'POST'; handler: Handler }> = {
  '/api/list-plans': {
    method: 'GET',
    handler: (req, deps) => listPlansCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/limits': {
    method: 'GET',
    handler: (req, deps) => checkLimitsCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/check-purchase': {
    method: 'GET',
    handler: (req, deps) => checkPurchaseCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/customer-balance': {
    method: 'GET',
    handler: (req, deps) => getCustomerBalanceCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/merchant': {
    method: 'GET',
    handler: (req, deps) => getMerchantCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/get-product': {
    method: 'GET',
    handler: (req, deps) => getProductCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/payment-method': {
    method: 'GET',
    handler: (req, deps) => getPaymentMethodCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/create-payment-intent': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as { planRef: string; productRef: string }
      return createPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/process-payment': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as {
        paymentIntentId: string
        productRef: string
        planRef?: string
      }
      return processPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/create-topup-payment-intent': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as {
        amount: number
        currency: string
        description?: string
      }
      return createTopupPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/process-topup-payment': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as { paymentIntentId: string }
      return processTopupPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/activate-plan': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as { productRef: string; planRef: string }
      return activatePlanCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/cancel-renewal': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as { purchaseRef: string; reason?: string }
      return cancelPurchaseCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/reactivate-renewal': {
    method: 'POST',
    handler: async (req, deps) => {
      const body = (await req.json()) as { purchaseRef: string }
      return reactivatePurchaseCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
}

export async function handleApiRequest(
  req: Request,
  deps: ApiDeps,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url)

  // The streaming chat path owns its own Response (NDJSON ReadableStream
  // body + 402 paywall short-circuit) — bypass the JSON dispatcher.
  // `payable.gate()` reads `x-customer-ref` directly, so no header
  // rewrite is required. `ctx` is forwarded so the SDK's bound
  // `trackSuccess` / `trackFail` can keep usage tracking alive past
  // the response close on Workers via `ctx.waitUntil`. The Vite dev
  // plugin (Node) calls without `ctx`; the Node event loop keeps the
  // floated promise alive without it.
  if (url.pathname === '/api/chat') {
    return handleChat(req, deps, ctx)
  }

  // Non-chat routes still flow through the `*Core` helpers which auth
  // via `x-user-id`. Mirror `x-customer-ref` once, up front, so each
  // helper sees the header `getAuthenticatedUserCore` reads.
  const normalised = withUserIdHeader(req)
  const route = HANDLERS[url.pathname]
  if (!route) {
    return jsonResponse(404, { error: `Unknown SolvaPay route: ${url.pathname}` })
  }
  if (req.method !== route.method) {
    return jsonResponse(405, { error: `Method not allowed: ${req.method}` })
  }

  try {
    const result = await route.handler(normalised, deps)
    if (isErrorResult(result)) {
      return jsonResponse(result.status, result)
    }
    return jsonResponse(200, result)
  } catch (error) {
    console.error('[solvapay-api] handler error:', error)
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Internal server error',
    })
  }
}

/**
 * Clone the incoming `Request` with `x-user-id` mirrored from
 * `x-customer-ref`. The browser sends the anonymous customer ref under
 * the demo-specific header; SolvaPay's `getAuthenticatedUserCore`
 * reads `x-user-id`, treating it as the externalRef (no JWT required).
 */
function withUserIdHeader(req: Request): Request {
  const customerRef = req.headers.get('x-customer-ref')
  if (!customerRef || req.headers.get('x-user-id')) return req

  const headers = new Headers(req.headers)
  headers.set('x-user-id', customerRef)
  return new Request(req, { headers })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
