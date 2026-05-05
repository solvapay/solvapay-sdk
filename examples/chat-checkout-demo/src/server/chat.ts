import type { IncomingMessage, ServerResponse } from 'node:http'
import { GoogleGenAI, type Content } from '@google/genai'
import {
  PaywallError,
  buildGateMessage,
  classifyPaywallState,
  createSolvaPay,
  paywallErrorToClientPayload,
  type PaywallStructuredContent,
} from '@solvapay/server'

const SYSTEM_INSTRUCTION_BASE =
  'You are a helpful assistant. Keep responses brief and conversational.'

const GEMINI_MODEL = 'gemini-3-flash-preview'

interface ChatRequestBody {
  productRef: string
  messages: Array<{ role: 'user' | 'bot'; text: string }>
}

let solvaPaySingleton: ReturnType<typeof createSolvaPay> | null = null
function getSolvaPay() {
  if (!solvaPaySingleton) {
    solvaPaySingleton = createSolvaPay({
      apiKey: process.env.SOLVAPAY_SECRET_KEY,
      apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
    })
  }
  return solvaPaySingleton
}

let geminiSingleton: GoogleGenAI | null = null
function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to .env to enable chat.')
  }
  if (!geminiSingleton) {
    geminiSingleton = new GoogleGenAI({ apiKey })
  }
  return geminiSingleton
}

/**
 * Streams Gemini chat through SolvaPay's paywall.
 *
 * Flow:
 *   1. Resolve the anonymous customer ref (`anon_<uuid>`) to a backend
 *      `cus_*` ref via `solvaPay.ensureCustomer`.
 *   2. Pre-check usage via `solvaPay.checkLimits` keyed on the requested
 *      `productRef` and `meterName: 'requests'`. The product's plan
 *      `freeUnits` determines the free message cap — no client-side
 *      limit, no env var.
 *   3. On gate, respond `402 Payment Required` with the standard
 *      `PaywallStructuredContent` payload. The browser already knows
 *      how to render this via the existing `Paywall` component.
 *   4. On allow, build a fresh Gemini chat (history rebuilt from the
 *      caller's messages array — server is stateless), stream chunks
 *      back as NDJSON, and emit `trackUsage` once the stream finishes.
 *
 * `paywall.decide()` would consolidate steps 1–3, but it's optimised
 * for one-shot JSON responses; for streaming we use the lower-level
 * `checkLimits` + `trackUsage` pair so the response writer stays in
 * our hands.
 */
export async function handleChatRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const customerRef = headerValue(req, 'x-customer-ref')
  if (!customerRef) {
    sendJson(res, 401, { error: 'Missing x-customer-ref header' })
    return
  }

  let body: ChatRequestBody
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw) as ChatRequestBody
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body.productRef || !Array.isArray(body.messages) || body.messages.length === 0) {
    sendJson(res, 400, { error: 'productRef and a non-empty messages array are required' })
    return
  }

  const sdk = getSolvaPay()

  let backendCustomerRef: string
  try {
    backendCustomerRef = await sdk.ensureCustomer(customerRef, customerRef)
  } catch (error) {
    console.error('[chat] ensureCustomer failed:', error)
    sendJson(res, 500, { error: 'Failed to resolve customer' })
    return
  }

  // Use `apiClient.checkLimits` rather than the factory-wrapped
  // `sdk.checkLimits`: the factory wrapper has a narrower return type
  // that hides fields like `activationRequired`, `plans`, `balance`,
  // and `confirmationUrl` we need to construct the gate. Underneath
  // both call the same `/v1/sdk/limits` endpoint.
  let limits: Awaited<ReturnType<typeof sdk.apiClient.checkLimits>>
  try {
    limits = await sdk.apiClient.checkLimits({
      customerRef: backendCustomerRef,
      productRef: body.productRef,
      meterName: 'requests',
    })
  } catch (error) {
    console.error('[chat] checkLimits failed:', error)
    sendJson(res, 500, { error: 'Failed to check usage limits' })
    return
  }

  if (!limits.withinLimits) {
    const gate = buildGate(body.productRef, limits)
    const errorMessage =
      gate.kind === 'activation_required' ? 'Activation required' : 'Payment required'
    sendJson(res, 402, paywallErrorToClientPayload(new PaywallError(errorMessage, gate)))
    return
  }

  const systemInstruction = await buildSystemInstruction(body.productRef).catch(error => {
    console.warn('[chat] system instruction build failed; falling back to base:', error)
    return SYSTEM_INSTRUCTION_BASE
  })

  let ai: GoogleGenAI
  try {
    ai = getGemini()
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Gemini unavailable' })
    return
  }

  const lastMessage = body.messages[body.messages.length - 1]?.text ?? ''
  if (!lastMessage.trim()) {
    sendJson(res, 400, { error: 'Last message must be non-empty user text' })
    return
  }

  const history: Content[] = body.messages.slice(0, -1).map(m => ({
    role: m.role === 'bot' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }))

  const chat = ai.chats.create({
    model: GEMINI_MODEL,
    config: { systemInstruction },
    history,
  })

  res.statusCode = 200
  res.setHeader('content-type', 'application/x-ndjson')
  res.setHeader('cache-control', 'no-cache')

  const startTime = Date.now()
  const requestId = `chat_${startTime}_${Math.random().toString(36).slice(2, 8)}`

  try {
    const stream = await chat.sendMessageStream({ message: lastMessage })
    for await (const chunk of stream) {
      const text = chunk.text ?? ''
      if (text) {
        res.write(JSON.stringify({ chunk: text }) + '\n')
      }
    }
    res.end()
    void sdk
      .trackUsage({
        customerRef: backendCustomerRef,
        productRef: body.productRef,
        actionType: 'api_call',
        units: 1,
        outcome: 'success',
        duration: Date.now() - startTime,
        metadata: { action: 'requests', requestId },
        timestamp: new Date().toISOString(),
      })
      .catch(error => console.error('[chat] trackUsage(success) failed:', error))
  } catch (error) {
    console.error('[chat] gemini stream error:', error)
    if (!res.writableEnded) {
      res.write(JSON.stringify({ error: 'gemini_error' }) + '\n')
      res.end()
    }
    void sdk
      .trackUsage({
        customerRef: backendCustomerRef,
        productRef: body.productRef,
        actionType: 'api_call',
        units: 1,
        outcome: 'fail',
        duration: Date.now() - startTime,
        metadata: { action: 'requests', requestId },
        timestamp: new Date().toISOString(),
      })
      .catch(() => {})
  }
}

/**
 * Construct a `PaywallStructuredContent` gate from a `LimitResponse`,
 * mirroring the shape `paywall.decide()` returns. We hand-roll it here
 * because the streaming chat path can't use `payable.http`'s
 * single-response adapter contract.
 */
function buildGate(
  productRef: string,
  limits: Awaited<
    ReturnType<ReturnType<typeof createSolvaPay>['apiClient']['checkLimits']>
  >,
): PaywallStructuredContent {
  const preMessage: PaywallStructuredContent = limits.activationRequired
    ? {
        kind: 'activation_required',
        product: productRef,
        message: '',
        checkoutUrl: limits.confirmationUrl || limits.checkoutUrl || '',
        ...(limits.confirmationUrl !== undefined ? { confirmationUrl: limits.confirmationUrl } : {}),
        ...(limits.plans !== undefined ? { plans: limits.plans } : {}),
        ...(limits.balance !== undefined ? { balance: limits.balance } : {}),
        ...(limits.product !== undefined ? { productDetails: limits.product } : {}),
      }
    : {
        kind: 'payment_required',
        product: productRef,
        checkoutUrl: limits.checkoutUrl || '',
        message: '',
        ...(limits.balance !== undefined ? { balance: limits.balance } : {}),
        ...(limits.product !== undefined ? { productDetails: limits.product } : {}),
      }

  const state = classifyPaywallState({ ...limits, plan: '' })
  return { ...preMessage, message: buildGateMessage(state, preMessage) }
}

/**
 * Build the Gemini system instruction from the active product's plans.
 * Keeps the bot's quoted pricing in lockstep with whatever the merchant
 * configures in SolvaPay — no string drift between UI and bot answers.
 */
async function buildSystemInstruction(productRef: string): Promise<string> {
  const sdk = getSolvaPay()
  if (!sdk.apiClient.listPlans) return SYSTEM_INSTRUCTION_BASE
  const plans = await sdk.apiClient.listPlans(productRef)
  const paidPlans = plans.filter(p => p.requiresPayment !== false)
  if (paidPlans.length === 0) return SYSTEM_INSTRUCTION_BASE
  const lines = paidPlans.map(p => {
    const price = ((p.price ?? 0) / 100).toFixed(2)
    const currency = (p.currency ?? 'USD').toUpperCase()
    const cycle = p.billingCycle ? `/${p.billingCycle}` : ''
    return `${p.name ?? p.reference}: ${currency} ${price}${cycle}`
  })
  return `${SYSTEM_INSTRUCTION_BASE} Pricing (only mention if asked): ${lines.join('; ')}.`
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  return value
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
