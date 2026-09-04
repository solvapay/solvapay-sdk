import type { ExecutionContext } from '@cloudflare/workers-types'
import type { BusinessDetailsInput } from '@solvapay/core'
import {
  activatePlanCore,
  attachBusinessDetailsCore,
  cancelPurchaseCore,
  checkLimitsCore,
  checkPurchaseCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  disableAutoRechargeCore,
  getAutoRechargeCore,
  getCustomerBalanceCore,
  getMerchantCore,
  getPaymentMethodCore,
  getProductCore,
  getUsageCore,
  isErrorResult,
  listPlansCore,
  processPaymentIntentCore,
  processTopupPaymentIntentCore,
  reactivatePurchaseCore,
  saveAutoRechargeCore,
  syncCustomerCore,
  type AutoRechargeInput,
  type SolvaPay,
} from '@solvapay/server'
import { handleChat } from './chat'

/**
 * Runtime-agnostic API dispatcher for the chat-checkout demo. Both the
 * Vite dev plugin (Node runtime) and the Cloudflare Worker (V8 isolate)
 * call into this. Every dependency is passed explicitly so the helpers
 * never have to read `process.env` — that's what keeps this Workers-safe.
 *
 * The route table covers every endpoint in the React transport's
 * `DEFAULT_ROUTES`, so any SolvaPay primitive the demo grows into is
 * already served. Keep it that way — a missing entry surfaces to the
 * customer as an opaque "Unknown SolvaPay route" inside the checkout.
 */
export interface ApiDeps {
  solvaPay: SolvaPay
  geminiApiKey: string
}

type Handler = (request: Request, deps: ApiDeps) => Promise<unknown>

const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const
type Method = (typeof METHODS)[number]

const isMethod = (value: string): value is Method => METHODS.some(method => method === value)

const HANDLERS: Record<string, Partial<Record<Method, Handler>>> = {
  '/api/list-plans': {
    GET: (req, deps) => listPlansCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/limits': {
    GET: (req, deps) => checkLimitsCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/usage': {
    GET: (req, deps) => getUsageCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/check-purchase': {
    GET: (req, deps) => checkPurchaseCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/customer-balance': {
    GET: (req, deps) => getCustomerBalanceCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/merchant': {
    GET: (req, deps) => getMerchantCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/get-product': {
    GET: (req, deps) => getProductCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/payment-method': {
    GET: (req, deps) => getPaymentMethodCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/auto-recharge': {
    GET: (req, deps) => getAutoRechargeCore(req, { solvaPay: deps.solvaPay }),
    PUT: async (req, deps) => {
      const body = (await req.json()) as AutoRechargeInput
      return saveAutoRechargeCore(req, body, { solvaPay: deps.solvaPay })
    },
    DELETE: (req, deps) => disableAutoRechargeCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/sync-customer': {
    POST: async (req, deps) => {
      // Unlike every other helper this one resolves to a bare customerRef
      // string, so wrap it into the object shape the transport expects.
      const result = await syncCustomerCore(req, { solvaPay: deps.solvaPay })
      if (isErrorResult(result)) return result
      return { customerRef: result, success: true }
    },
  },
  '/api/create-payment-intent': {
    POST: async (req, deps) => {
      const body = (await req.json()) as { planRef: string; productRef: string }
      return createPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/process-payment': {
    POST: async (req, deps) => {
      const body = (await req.json()) as {
        paymentIntentId: string
        productRef: string
        planRef?: string
      }
      return processPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/create-topup-payment-intent': {
    POST: async (req, deps) => {
      const body = (await req.json()) as {
        amount: number
        currency: string
        description?: string
      }
      return createTopupPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/process-topup-payment': {
    POST: async (req, deps) => {
      const body = (await req.json()) as { paymentIntentId: string }
      return processTopupPaymentIntentCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/attach-business-details': {
    POST: async (req, deps) => {
      const body = (await req.json()) as {
        paymentIntentId: string
        customerRef?: string
      } & BusinessDetailsInput
      return attachBusinessDetailsCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/create-checkout-session': {
    POST: async (req, deps) => {
      const body = (await req.json()) as {
        productRef: string
        planRef?: string
        returnUrl?: string
      }
      return createCheckoutSessionCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/create-customer-session': {
    POST: (req, deps) => createCustomerSessionCore(req, { solvaPay: deps.solvaPay }),
  },
  '/api/activate-plan': {
    POST: async (req, deps) => {
      const body = (await req.json()) as { productRef: string; planRef: string }
      return activatePlanCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/cancel-renewal': {
    POST: async (req, deps) => {
      const body = (await req.json()) as { purchaseRef: string; reason?: string }
      return cancelPurchaseCore(req, body, { solvaPay: deps.solvaPay })
    },
  },
  '/api/reactivate-renewal': {
    POST: async (req, deps) => {
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
  const handler = isMethod(req.method) ? route[req.method] : undefined
  if (!handler) {
    return jsonResponse(405, { error: `Method not allowed: ${req.method} ${url.pathname}` })
  }

  try {
    const result = await handler(normalised, deps)
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
