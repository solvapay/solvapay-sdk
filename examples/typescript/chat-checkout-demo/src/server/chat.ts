import type { ExecutionContext } from '@cloudflare/workers-types'
import { GoogleGenAI, type Content } from '@google/genai'
import type { SolvaPay } from '@solvapay/server'

const SYSTEM_INSTRUCTION_BASE =
  'You are a helpful assistant. Keep responses brief and conversational.'

const GEMINI_MODEL = 'gemini-3-flash-preview'

// Gemini 3 Flash defaults to an internal "thinking" pass before emitting
// the first output token, which adds several seconds of dead air for a
// brief conversational assistant. `thinkingBudget: 0` disables thinking
// so streaming starts immediately. Raise to a small positive number
// (e.g. 128) if a richer reply is worth the latency.
const GEMINI_THINKING_BUDGET = 0

// Plans drive the system instruction's pricing snippet; they change on
// merchant-action timescales, not per-message. Cache the resolved
// instruction per `productRef` so we don't pay a `listPlans` roundtrip
// on every chat send. The TTL caps drift if a merchant edits plans
// while the worker/server is warm.
const SYSTEM_INSTRUCTION_TTL_MS = 60_000

const systemInstructionCache = new Map<string, { value: Promise<string>; expiresAt: number }>()

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
 * Built on `solvaPay.payable({ productRef }).gate(req, { ctx })` —
 * the SDK's decision-shaped primitive for streaming flows. The gate
 * call returns either:
 *  - `{ kind: 'paywall', response, content }` on a 402 — return the
 *    pre-built response directly; or
 *  - `{ kind: 'allow', customerRef, trackSuccess, trackFail }` on
 *    allow — bind those closures to the stream lifecycle so usage is
 *    recorded once the LLM stream finalises.
 *
 * On Workers, `ctx.waitUntil` keeps `trackUsage` alive past the
 * response close. On Node (Vite dev) `ctx` is `undefined` and the
 * Node event loop keeps the floated promise alive without it — the
 * SDK handles both transparently when a `ctx` is passed.
 */
export async function handleChat(
  req: Request,
  deps: ChatDeps,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
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

  const lastMessage = body.messages[body.messages.length - 1]?.text ?? ''
  if (!lastMessage.trim()) {
    return jsonResponse(400, { error: 'Last message must be non-empty user text' })
  }

  if (!deps.geminiApiKey) {
    return jsonResponse(500, { error: 'Gemini unavailable: GEMINI_API_KEY not configured' })
  }

  const payable = deps.solvaPay.payable({ productRef: body.productRef })
  // `getCustomerRef` reads the demo's `x-customer-ref` header. A
  // production app would replace this with a JWT-shaped resolver
  // (verify the bearer token, return the `sub` claim) — see the
  // README for the swap pattern.
  //
  // Run the gate decision and the (usually cached) system instruction
  // fetch in parallel. On a cache hit the instruction promise is
  // already resolved and this collapses to a single roundtrip; on a
  // cold cache we overlap the two SolvaPay calls instead of paying
  // them serially.
  const [gate, systemInstruction] = await Promise.all([
    payable.gate(req, { ctx }),
    getSystemInstruction(deps.solvaPay, body.productRef),
  ])

  if (gate.kind === 'paywall') {
    return gate.response
  }

  const ai = new GoogleGenAI({ apiKey: deps.geminiApiKey })
  const history: Content[] = body.messages.slice(0, -1).map(m => ({
    role: m.role === 'bot' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }))
  const chat = ai.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
    },
    history,
  })

  const startTime = Date.now()
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
        gate.trackSuccess({ duration: Date.now() - startTime })
      } catch (error) {
        console.error('[chat] gemini stream error:', error)
        controller.enqueue(encoder.encode(JSON.stringify({ error: 'gemini_error' }) + '\n'))
        controller.close()
        gate.trackFail(error, { duration: Date.now() - startTime })
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
 * Cached accessor for the per-product system instruction. Caches the
 * in-flight `Promise` (not the resolved value) so concurrent first
 * requests share a single `listPlans` roundtrip. Failures evict the
 * entry so the next request retries instead of being pinned to the
 * fallback for the TTL window.
 */
function getSystemInstruction(solvaPay: SolvaPay, productRef: string): Promise<string> {
  const now = Date.now()
  const cached = systemInstructionCache.get(productRef)
  if (cached && cached.expiresAt > now) return cached.value
  const value = buildSystemInstruction(solvaPay, productRef).catch(error => {
    const current = systemInstructionCache.get(productRef)
    if (current?.value === value) {
      systemInstructionCache.delete(productRef)
    }
    console.warn('[chat] system instruction build failed; falling back to base:', error)
    return SYSTEM_INSTRUCTION_BASE
  })
  systemInstructionCache.set(productRef, {
    value,
    expiresAt: now + SYSTEM_INSTRUCTION_TTL_MS,
  })
  return value
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
