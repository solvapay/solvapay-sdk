import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  cancelPurchaseCore,
  checkPurchaseCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  getCustomerBalanceCore,
  getMerchantCore,
  getProductCore,
  getPaymentMethodCore,
  isErrorResult,
  listPlansCore,
  processPaymentIntentCore,
  reactivatePurchaseCore,
} from '@solvapay/server'
import { handleChatRequest } from './chat'

/**
 * Dispatch table: HTTP route → core helper. Each handler takes a Web `Request`
 * (built from the incoming Node `IncomingMessage`) and returns either an
 * error result or a JSON-serialisable success payload.
 */
type Handler = (request: Request) => Promise<unknown>

const HANDLERS: Record<string, { method: 'GET' | 'POST'; handler: Handler }> = {
  '/api/list-plans': {
    method: 'GET',
    handler: req => listPlansCore(req),
  },
  '/api/check-purchase': {
    method: 'GET',
    handler: req => checkPurchaseCore(req),
  },
  '/api/customer-balance': {
    method: 'GET',
    handler: req => getCustomerBalanceCore(req),
  },
  '/api/merchant': {
    method: 'GET',
    handler: req => getMerchantCore(req),
  },
  '/api/get-product': {
    method: 'GET',
    handler: req => getProductCore(req),
  },
  '/api/payment-method': {
    method: 'GET',
    handler: req => getPaymentMethodCore(req),
  },
  '/api/create-payment-intent': {
    method: 'POST',
    handler: async req => {
      const body = (await req.json()) as { planRef: string; productRef: string }
      return createPaymentIntentCore(req, body)
    },
  },
  '/api/process-payment': {
    method: 'POST',
    handler: async req => {
      const body = (await req.json()) as {
        paymentIntentId: string
        productRef: string
        planRef?: string
      }
      return processPaymentIntentCore(req, body)
    },
  },
  '/api/create-topup-payment-intent': {
    method: 'POST',
    handler: async req => {
      const body = (await req.json()) as {
        amount: number
        currency: string
        description?: string
      }
      return createTopupPaymentIntentCore(req, body)
    },
  },
  '/api/cancel-renewal': {
    method: 'POST',
    handler: async req => {
      const body = (await req.json()) as { purchaseRef: string; reason?: string }
      return cancelPurchaseCore(req, body)
    },
  },
  '/api/reactivate-renewal': {
    method: 'POST',
    handler: async req => {
      const body = (await req.json()) as { purchaseRef: string }
      return reactivatePurchaseCore(req, body)
    },
  },
}

export async function handleSolvaPayRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // Streaming chat path bypasses the JSON-response dispatcher because it
  // writes NDJSON chunks directly. Auth/limit enforcement happens inside
  // `handleChatRequest` via SolvaPay's `checkLimits` + 402 response.
  if (url.pathname === '/api/chat') {
    await handleChatRequest(req, res)
    return
  }

  const route = HANDLERS[url.pathname]
  if (!route) {
    sendJson(res, 404, { error: `Unknown SolvaPay route: ${url.pathname}` })
    return
  }
  if (req.method !== route.method) {
    sendJson(res, 405, { error: `Method not allowed: ${req.method}` })
    return
  }

  try {
    const request = await toWebRequest(req, url)
    const result = await route.handler(request)
    if (isErrorResult(result)) {
      sendJson(res, result.status, result)
      return
    }
    sendJson(res, 200, result)
  } catch (error) {
    console.error('[solvapay-api] handler error:', error)
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Internal server error',
    })
  }
}

async function toWebRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else if (typeof value === 'string') {
      headers.set(key, value)
    }
  }

  // Anonymous-customer flow: the browser sends `x-customer-ref` (UUID stored
  // in localStorage). Rewrite it to `x-user-id` so the SolvaPay auth helper
  // (`getAuthenticatedUserCore`) treats it as the externalRef without the
  // request needing a JWT.
  const customerRef = headers.get('x-customer-ref')
  if (customerRef && !headers.get('x-user-id')) {
    headers.set('x-user-id', customerRef)
  }

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await readBody(req)
  }

  return new Request(url.toString(), init)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
