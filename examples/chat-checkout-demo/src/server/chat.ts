import { GoogleGenAI, type Content } from '@google/genai'
import {
  PaywallError,
  buildGateMessage,
  classifyPaywallState,
  paywallErrorToClientPayload,
  type PaywallStructuredContent,
  type SolvaPay,
} from '@solvapay/server'

const SYSTEM_INSTRUCTION_BASE =
  'You are a helpful assistant. Keep responses brief and conversational.'

const GEMINI_MODEL = 'gemini-3-flash-preview'

interface ChatRequestBody {
  productRef: string
  messages: Array<{ role: 'user' | 'bot'; text: string }>
}

interface ChatDeps {
  solvaPay: SolvaPay
  geminiApiKey: string
}

/**
 * Streams Gemini chat through SolvaPay's paywall as a Web-standard
 * `Response`. Same NDJSON wire format the browser already parses
 * (`{chunk}` lines + a final `{error}` line on failure).
 *
 * Flow:
 *   1. Resolve the anonymous customer ref (`anon_<uuid>`) to a backend
 *      `cus_*` ref via `solvaPay.ensureCustomer`.
 *   2. Pre-check usage via `solvaPay.checkLimits` keyed on the requested
 *      `productRef` and `meterName: 'requests'`. The product's plan
 *      `freeUnits` determines the free message cap — no client-side
 *      limit, no env var.
 *   3. On gate, return `402 Payment Required` with the standard
 *      `PaywallStructuredContent` payload. The browser's existing
 *      `Paywall` component already knows how to render this.
 *   4. On allow, build a fresh Gemini chat (history rebuilt from the
 *      caller's messages array — server is stateless), stream chunks
 *      back via a `ReadableStream`, and emit `trackUsage` once the
 *      stream finishes.
 *
 * `paywall.decide()` would consolidate steps 1–3, but it's optimised
 * for one-shot JSON responses; for streaming we use the lower-level
 * `checkLimits` + `trackUsage` pair so the response writer stays in
 * our hands.
 */
export async function handleChat(req: Request, deps: ChatDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const customerRef = req.headers.get('x-customer-ref')
  if (!customerRef) {
    return jsonResponse(401, { error: 'Missing x-customer-ref header' })
  }

  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  if (!body.productRef || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse(400, { error: 'productRef and a non-empty messages array are required' })
  }

  let backendCustomerRef: string
  try {
    backendCustomerRef = await deps.solvaPay.ensureCustomer(customerRef, customerRef)
  } catch (error) {
    console.error('[chat] ensureCustomer failed:', error)
    return jsonResponse(500, { error: 'Failed to resolve customer' })
  }

  // Use `apiClient.checkLimits` rather than the factory-wrapped
  // `solvaPay.checkLimits`: the factory wrapper has a narrower return
  // type that hides fields like `activationRequired`, `plans`, `balance`,
  // and `confirmationUrl` we need to construct the gate. Underneath
  // both call the same `/v1/sdk/limits` endpoint.
  let limits: Awaited<ReturnType<typeof deps.solvaPay.apiClient.checkLimits>>
  try {
    limits = await deps.solvaPay.apiClient.checkLimits({
      customerRef: backendCustomerRef,
      productRef: body.productRef,
      meterName: 'requests',
    })
  } catch (error) {
    console.error('[chat] checkLimits failed:', error)
    return jsonResponse(500, { error: 'Failed to check usage limits' })
  }

  console.warn(
    `[chat] limits product=${body.productRef} customer=${backendCustomerRef} ` +
      `withinLimits=${limits.withinLimits} remaining=${limits.remaining ?? 'n/a'} ` +
      `activationRequired=${limits.activationRequired ?? false}`,
  )

  // Auto-activate the metered plan for top-up customers who've already
  // funded a balance. Buying a one-time credit pack deposits credits but
  // doesn't enrol the customer in the usage-based "Pay as you go" plan
  // that drives the meter — so `checkLimits` keeps returning
  // `activationRequired: true` even though the wallet has plenty to
  // debit. We safely auto-activate iff the candidate plan costs nothing
  // (no silent upgrade to a paid plan) and the customer has positive
  // credits (clear signal they intended to use it).
  if (!limits.withinLimits && limits.activationRequired) {
    const meterPlan = limits.plans?.find(
      p => p.type === 'usage-based' && (p.price ?? 0) === 0,
    )
    const creditBalance = limits.balance?.creditBalance ?? 0
    if (meterPlan && creditBalance > 0 && deps.solvaPay.activatePlan) {
      console.warn(
        `[chat] auto-activating meter plan=${meterPlan.reference} for customer=${backendCustomerRef} ` +
          `(creditBalance=${creditBalance})`,
      )
      try {
        await deps.solvaPay.activatePlan({
          customerRef: backendCustomerRef,
          productRef: body.productRef,
          planRef: meterPlan.reference,
        })
        limits = await deps.solvaPay.apiClient.checkLimits({
          customerRef: backendCustomerRef,
          productRef: body.productRef,
          meterName: 'requests',
        })
      } catch (error) {
        console.error('[chat] auto-activate failed:', error)
      }
    }
  }

  if (!limits.withinLimits) {
    const gate = buildGate(body.productRef, limits)
    const errorMessage =
      gate.kind === 'activation_required' ? 'Activation required' : 'Payment required'
    return jsonResponse(402, paywallErrorToClientPayload(new PaywallError(errorMessage, gate)))
  }

  const lastMessage = body.messages[body.messages.length - 1]?.text ?? ''
  if (!lastMessage.trim()) {
    return jsonResponse(400, { error: 'Last message must be non-empty user text' })
  }

  if (!deps.geminiApiKey) {
    return jsonResponse(500, { error: 'Gemini unavailable: GEMINI_API_KEY not configured' })
  }

  const systemInstruction = await buildSystemInstruction(deps.solvaPay, body.productRef).catch(
    error => {
      console.warn('[chat] system instruction build failed; falling back to base:', error)
      return SYSTEM_INSTRUCTION_BASE
    },
  )

  const ai = new GoogleGenAI({ apiKey: deps.geminiApiKey })
  const history: Content[] = body.messages.slice(0, -1).map(m => ({
    role: m.role === 'bot' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }))
  const chat = ai.chats.create({
    model: GEMINI_MODEL,
    config: { systemInstruction },
    history,
  })

  const startTime = Date.now()
  const requestId = `chat_${startTime}_${Math.random().toString(36).slice(2, 8)}`
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const geminiStream = await chat.sendMessageStream({ message: lastMessage })
        for await (const chunk of geminiStream) {
          const text = chunk.text ?? ''
          if (text) {
            controller.enqueue(encoder.encode(JSON.stringify({ chunk: text }) + '\n'))
          }
        }
        controller.close()
        void deps.solvaPay
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
        controller.enqueue(encoder.encode(JSON.stringify({ error: 'gemini_error' }) + '\n'))
        controller.close()
        void deps.solvaPay
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
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
    },
  })
}

/**
 * Construct a `PaywallStructuredContent` gate from a `LimitResponse`,
 * mirroring the shape `paywall.decide()` returns. Hand-rolled here
 * because the streaming chat path can't use `payable.http`'s
 * single-response adapter contract.
 */
function buildGate(
  productRef: string,
  limits: Awaited<ReturnType<SolvaPay['apiClient']['checkLimits']>>,
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
async function buildSystemInstruction(solvaPay: SolvaPay, productRef: string): Promise<string> {
  if (!solvaPay.apiClient.listPlans) return SYSTEM_INSTRUCTION_BASE
  const plans = await solvaPay.apiClient.listPlans(productRef)
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
