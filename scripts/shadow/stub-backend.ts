/**
 * Deterministic stub backend for offline shadow self-test.
 *
 * Returns volatile-but-plausible JSON (unique refs/timestamps per call).
 * Set `opts.divergeListPlansPrice` to make TS vs Rust see different prices
 * when they hit listPlans (used for the intentional-divergence control).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export type StubBackendOptions = {
  /** When true, alternate listPlans price 100 / 999 so clients diverge. */
  divergeListPlansPrice?: boolean
}

export type StubBackend = {
  baseUrl: string
  close: () => Promise<void>
}

let seq = 0
function nextRef(prefix: string): string {
  seq += 1
  return `${prefix}${seq.toString(36)}_${Date.now().toString(36)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = body === undefined || body === null ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export async function startStubBackend(
  options: StubBackendOptions = {},
): Promise<StubBackend> {
  seq = 0
  let listPlansHits = 0

  const products = new Map<string, Record<string, unknown>>()
  const plans = new Map<string, Record<string, unknown>>()
  const customers = new Map<string, Record<string, unknown>>()

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const method = (req.method ?? 'GET').toUpperCase()
    const pathname = url.pathname
    const body = await readJson(req)

    // Merchant / config
    if (method === 'GET' && pathname === '/v1/sdk/merchant') {
      return send(res, 200, {
        displayName: 'Stub Merchant',
        legalName: 'Stub Merchant LLC',
        createdAt: nowIso(),
      })
    }
    if (method === 'GET' && pathname === '/v1/sdk/platform-config') {
      return send(res, 200, { stripePublishableKey: 'pk_test_stub' })
    }

    // Products
    if (method === 'GET' && pathname === '/v1/sdk/products') {
      return send(res, 200, { products: [...products.values()] })
    }
    if (method === 'POST' && pathname === '/v1/sdk/products') {
      const ref = nextRef('prd_')
      const product = {
        reference: ref,
        name: (body as { name?: string })?.name ?? 'Product',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      products.set(ref, product)
      return send(res, 200, product)
    }
    if (method === 'POST' && pathname === '/v1/sdk/products/mcp/bootstrap') {
      const ref = nextRef('prd_')
      const originUrl =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { originUrl?: unknown }).originUrl === 'string'
          ? (body as { originUrl: string }).originUrl
          : 'https://mcp.example.com'
      const product = {
        reference: ref,
        name: 'MCP',
      }
      products.set(ref, product)
      return send(res, 200, {
        product,
        mcpServer: { url: originUrl },
        planMap: {},
      })
    }

    const productMatch = pathname.match(/^\/v1\/sdk\/products\/([^/]+)(.*)$/)
    if (productMatch) {
      const productRef = decodeURIComponent(productMatch[1])
      const rest = productMatch[2]

      if (method === 'GET' && rest === '') {
        if (productRef.startsWith('prd_shadow_does_not_exist')) {
          return send(res, 404, { message: 'Product not found' })
        }
        const product = products.get(productRef) ?? {
          reference: productRef,
          name: 'Unknown',
          createdAt: nowIso(),
        }
        return send(res, 200, product)
      }
      if (method === 'PUT' && rest === '') {
        const prev = products.get(productRef) ?? { reference: productRef }
        const updated = {
          ...prev,
          ...(typeof body === 'object' && body !== null ? body : {}),
          reference: productRef,
          updatedAt: nowIso(),
        }
        products.set(productRef, updated)
        return send(res, 200, updated)
      }
      if (method === 'DELETE' && rest === '') {
        products.delete(productRef)
        return send(res, 200, null)
      }
      if (method === 'POST' && rest === '/clone') {
        const ref = nextRef('prd_')
        const cloned = {
          reference: ref,
          name: (body as { name?: string })?.name ?? 'Clone',
          createdAt: nowIso(),
        }
        products.set(ref, cloned)
        return send(res, 200, cloned)
      }
      if (method === 'PUT' && rest === '/mcp/plans') {
        return send(res, 200, { planMap: {} })
      }
      if (method === 'GET' && rest === '/plans') {
        listPlansHits += 1
        const price = options.divergeListPlansPrice
          ? listPlansHits % 2 === 1
            ? 100
            : 999
          : 1000
        const list = [...plans.values()].filter(p => p.productRef === productRef)
        if (list.length === 0) {
          list.push({
            reference: nextRef('pln_'),
            productRef,
            name: 'Default',
            price,
            createdAt: nowIso(),
          })
        } else if (options.divergeListPlansPrice) {
          list[0] = { ...list[0], price }
        }
        return send(res, 200, { plans: list })
      }
      if (method === 'POST' && rest === '/plans') {
        const ref = nextRef('pln_')
        const plan = {
          reference: ref,
          productRef,
          name: (body as { name?: string })?.name ?? 'Plan',
          price: (body as { price?: number })?.price ?? 1000,
          createdAt: nowIso(),
        }
        plans.set(ref, plan)
        return send(res, 200, plan)
      }
      const planMatch = rest.match(/^\/plans\/([^/]+)$/)
      if (planMatch) {
        const planRef = decodeURIComponent(planMatch[1])
        if (method === 'PUT') {
          const prev = plans.get(planRef) ?? { reference: planRef, productRef }
          const updated = {
            ...prev,
            ...(typeof body === 'object' && body !== null ? body : {}),
            reference: planRef,
            productRef,
            updatedAt: nowIso(),
          }
          plans.set(planRef, updated)
          return send(res, 200, updated)
        }
        if (method === 'DELETE') {
          plans.delete(planRef)
          return send(res, 200, null)
        }
      }
    }

    // Customers
    if (method === 'POST' && pathname === '/v1/sdk/customers/customer-sessions') {
      const sessionId = nextRef('cusess_')
      return send(res, 200, {
        sessionId,
        customerUrl: `https://pay.test/portal/${sessionId}`,
      })
    }
    if (method === 'POST' && pathname === '/v1/sdk/customers') {
      const ref = nextRef('cus_')
      const customer = {
        reference: ref,
        customerRef: ref,
        email: (body as { email?: string })?.email ?? 'stub@example.com',
        createdAt: nowIso(),
      }
      customers.set(ref, customer)
      return send(res, 200, customer)
    }
    if (method === 'GET' && pathname === '/v1/sdk/customers') {
      const reference = url.searchParams.get('reference') ?? url.searchParams.get('email')
      if (reference?.startsWith('cus_shadow_does_not_exist')) {
        return send(res, 404, { message: 'Customer not found' })
      }
      const found = reference
        ? customers.get(reference) ?? {
            reference,
            customerRef: reference,
            email: 'unknown@example.com',
          }
        : undefined
      return send(res, 200, found ?? { customers: [...customers.values()] })
    }
    const customerMatch = pathname.match(/^\/v1\/sdk\/customers\/([^/]+)(.*)$/)
    if (customerMatch) {
      const customerRef = decodeURIComponent(customerMatch[1])
      const rest = customerMatch[2]
      if (customerRef.startsWith('cus_shadow_does_not_exist')) {
        return send(res, 404, { message: 'Customer not found' })
      }
      if (method === 'GET' && rest === '') {
        return send(
          res,
          200,
          customers.get(customerRef) ?? {
            reference: customerRef,
            customerRef,
            email: 'unknown@example.com',
          },
        )
      }
      if (method === 'PUT' && rest === '') {
        const prev = customers.get(customerRef) ?? {
          reference: customerRef,
          customerRef,
        }
        const updated = {
          ...prev,
          ...(typeof body === 'object' && body !== null ? body : {}),
          reference: customerRef,
          customerRef,
          updatedAt: nowIso(),
        }
        customers.set(customerRef, updated)
        return send(res, 200, updated)
      }
      if (method === 'POST' && rest === '/credits') {
        return send(res, 200, {
          customerRef,
          credits: (body as { credits?: number })?.credits ?? 0,
        })
      }
      if (method === 'GET' && rest === '/balance') {
        return send(res, 200, {
          customerRef,
          credits: 100,
          displayCurrency: 'usd',
          creditsPerMinorUnit: 1,
          displayExchangeRate: 1,
        })
      }
    }

    // Limits / usage — shapes aligned with Phase 0 fixtures / wire DTOs
    if (method === 'POST' && pathname === '/v1/sdk/limits') {
      return send(res, 200, {
        plan: 'plan_basic',
        remaining: 10,
      })
    }
    if (method === 'POST' && pathname === '/v1/sdk/usages') {
      return send(res, 200, { reference: nextRef('usg_'), outcome: 'success' })
    }
    if (method === 'POST' && pathname === '/v1/sdk/usages/bulk') {
      return send(res, 200, { accepted: 1, rejected: 0 })
    }

    // Sessions
    if (method === 'POST' && pathname === '/v1/sdk/checkout-sessions') {
      const sessionId = nextRef('ses_')
      return send(res, 200, {
        sessionId,
        checkoutUrl: `https://pay.test/cs/${sessionId}`,
      })
    }
    if (method === 'POST' && pathname === '/v1/sdk/activate') {
      // Match ActivatePlanResponseDto / fixture shape (not free-form fields).
      return send(res, 200, { status: 'activated' })
    }

    // User info (POST)
    if (method === 'POST' && pathname === '/v1/sdk/user-info') {
      return send(res, 200, { status: 'active' })
    }

    // Payment intents (stub — stripe scenarios usually skipped)
    if (method === 'POST' && pathname === '/v1/sdk/payment-intents') {
      return send(res, 200, {
        id: nextRef('pi_'),
        clientSecret: nextRef('secret_'),
        createdAt: nowIso(),
      })
    }

    if (method === 'GET' && pathname === '/v1/sdk/payment-method') {
      return send(res, 200, { kind: 'card', last4: '4242', createdAt: nowIso() })
    }
    if (pathname === '/v1/sdk/auto-recharge') {
      return send(res, 200, { enabled: false, createdAt: nowIso() })
    }
    if (pathname.match(/^\/v1\/sdk\/purchases\/[^/]+\/(cancel|reactivate)$/)) {
      return send(res, 200, {
        purchase: { reference: nextRef('pur_'), status: 'cancelled', createdAt: nowIso() },
      })
    }

    send(res, 404, { message: `stub: no route ${method} ${pathname}` })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('stub server failed to bind')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      }),
  }
}
