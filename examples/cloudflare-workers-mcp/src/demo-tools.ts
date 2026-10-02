/**
 * Demo paywalled tools for the Cloudflare Workers MCP starter.
 *
 * A toy stock-predictor oracle (`predict_price_chart`,
 * `predict_direction`) that shares a seeded simulation so both tools
 * agree for the same ticker. Swap these handlers out in
 * `registerDemoTools` when using this example as a template.
 *
 * Runtime-neutral: `demoToolsEnabled` reads the env flag through a
 * plain `Record<string, string | undefined>` default so the file
 * compiles under Workers (via the `env` binding passed in from
 * `worker.ts`), Node (via `process.env`), or Deno (via
 * `Deno.env.toObject()`). The tools, paywalled handlers, and seeded
 * oracle simulation are byte-for-byte identical with the sibling
 * `examples/supabase-edge-mcp` copy — the HTTP handler wrapping them
 * is the only thing that changes between runtimes.
 *
 * These tools illustrate how a "data MCP" server wraps its business
 * logic with the SolvaPay usage-based paywall. They are **not** part
 * of any `@solvapay/*` package — they consume `registerPayable`
 * exactly the way a third-party integrator would.
 *
 * Both tools return deterministic stub payloads (seeded from the
 * ticker symbol) so the demo is self-contained: no external market
 * data, API keys, or rate limits. Swap the handlers for real ones in
 * a few lines to turn this into a production oracle server.
 *
 * Dual-lane responses — neither field reaches the model on every host:
 *
 * Silent successes put a human summary on `content[0].text` and the
 * same payload on `structuredContent` plus a trailing JSON text block
 * (`dataInText`, default on). No host auto-renders `structuredContent`
 * as a chart without a declared `ui://` resource. The SolvaPay widget
 * is reserved for the `account` viewer (slash prompts `/upgrade`,
 * `/manage_account`, `/topup` remap onto it with `view`).
 *
 * Paywall responses on exhaustion are plain text narrations that name
 * `` `account` `` with the right `view` and inline `gate.checkoutUrl`
 * for terminal-first hosts. No iframe opens for a gate — the LLM
 * reads the narration and calls the recovery tool.
 *
 * Gate with the `DEMO_TOOLS` env var (defaults to `true` in dev; set
 * to `"false"` when copying this example to your own repo as a
 * template).
 */

import { z } from 'zod'
import { VIEWER_TOOL_NAME, type AdditionalToolsContext } from '@solvapay/mcp'
import type { McpServer } from '@modelcontextprotocol/server'

interface McpServerWithPrompts {
  registerPrompt: McpServer['registerPrompt']
}

/**
 * True when the `DEMO_TOOLS` env var is absent or set to anything other
 * than the literal string `"false"`. Reads `Deno.env` when available
 * (Supabase Edge / plain Deno) and falls back to an empty object when
 * both `Deno` and `process` are missing (so the module stays portable
 * across Web-standards runtimes without hard-coding a runtime probe).
 */
export function demoToolsEnabled(
  env: Record<string, string | undefined> = readEnv(),
): boolean {
  return env.DEMO_TOOLS !== 'false'
}

function readEnv(): Record<string, string | undefined> {
  const deno = (globalThis as { Deno?: { env: { toObject(): Record<string, string> } } }).Deno
  if (deno?.env) return deno.env.toObject()
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
  if (proc?.env) return proc.env
  return {}
}

/**
 * Registers the two paywalled Oracle demo tools + their slash-command
 * prompts on the server provided by `createSolvaPayMcpServer`'s
 * `additionalTools` hook.
 *
 * Tool shape mirrors
 * `examples/checkout-demo/app/components/UsageSimulator.tsx`: each
 * call consumes one unit of usage; when the customer runs out, the
 * tool returns a paywall bootstrap instead of results (handled
 * entirely by `solvaPay.payable().mcp()` inside `registerPayable`).
 *
 * Oracle tools return numeric arrays via `ctx.respond(payload)` with
 * a narrated `text` override. `dataInText` (default on) also appends
 * the serialized payload so hosts that ignore `structuredContent`
 * still hold the series. No host auto-renders `structuredContent`
 * as a chart. Paywall exhaustion ships a text-only narration; the
 * LLM calls `${VIEWER_TOOL_NAME}` with the right `view`.
 */
const USAGE_BILLING_SUFFIX = `Usage-based billing: each call counts one request against your active plan (included requests or credits, depending on the plan). Call \`${VIEWER_TOOL_NAME}\` with view: "account" to see what is left; when you run out, the response says how to continue.`

const priceChartOutputSchema = z.object({
  symbol: z.string(),
  currency: z.string(),
  asOf: z.string(),
  days: z.number(),
  history: z.object({ t: z.array(z.number()), price: z.array(z.number()) }),
  forecast: z.object({
    t: z.array(z.number()),
    price: z.array(z.number()),
    lower: z.array(z.number()),
    upper: z.array(z.number()),
  }),
})

const directionOutputSchema = z.object({
  symbol: z.string(),
  days: z.number(),
  direction: z.enum(['up', 'down']),
  confidence: z.number(),
  asOf: z.string(),
})

export function registerDemoTools(ctx: AdditionalToolsContext): void {
  const { registerPayable, server } = ctx

  registerPayable('predict_price_chart', {
    title: 'Predict price chart (Oracle demo)',
    description:
      `Returns recent daily price history and a forecast over the requested \`days\` horizon with an 80% confidence band. Parallel numeric arrays (history.t/price, forecast.t/price/lower/upper) so any chart library binds directly. ${USAGE_BILLING_SUFFIX}`,
    schema: {
      symbol: z.string().min(1).max(8),
      days: z.number().int().min(1).max(60).default(10),
    },
    outputSchema: priceChartOutputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ symbol, days }, ctx) => {
      const upper = symbol.toUpperCase()
      const path = simulatePricePath(upper, days)
      const today = path.history.price[path.history.price.length - 1]
      const dayN = path.forecast.price[path.forecast.price.length - 1]
      const changePct = ((dayN - today) / today) * 100
      const lo = path.forecast.lower[path.forecast.lower.length - 1]
      const hi = path.forecast.upper[path.forecast.upper.length - 1]
      const direction = changePct >= 0 ? 'up' : 'down'

      // Explicit narration + render instruction materially raises the
      // artifact-render hit rate vs. the SDK default of
      // `JSON.stringify(data)`. See
      // `unwrapResponseEnvelope` in `@solvapay/mcp`.
      const narration = [
        `${upper} price forecast for the next ${days} day${days === 1 ? '' : 's'} (demo data).`,
        `Today $${today.toFixed(2)} -> day ${days} forecast $${dayN.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%, trending ${direction}).`,
        `80% confidence band at day ${days}: $${lo.toFixed(2)} - $${hi.toFixed(2)}.`,
        `Render this as a line-chart artifact: plot history.price over history.t as a solid line, forecast.price over forecast.t dashed, and shade the area between forecast.lower and forecast.upper as the 80% confidence band. Include small summary tiles for today, day ${days} forecast, change %, and the day ${days} range.`,
      ].join(' ')

      return ctx.respond(
        {
          symbol: upper,
          currency: 'USD',
          asOf: ORACLE_AS_OF,
          days,
          history: path.history,
          forecast: path.forecast,
        },
        { text: narration },
      )
    },
  })

  registerPayable('predict_direction', {
    title: 'Predict direction (Oracle demo)',
    description:
      `Returns an up/down verdict with a confidence score in [0, 1] for a ticker over the requested horizon. Same seeded model as \`predict_price_chart\`, so the verdict matches the chart for the same symbol. ${USAGE_BILLING_SUFFIX}`,
    schema: {
      symbol: z.string().min(1).max(8),
      days: z.number().int().min(1).max(60).default(10),
    },
    outputSchema: directionOutputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ symbol, days }, ctx) => {
      const upper = symbol.toUpperCase()
      const path = simulatePricePath(upper, days)
      const { direction, confidence } = deriveVerdict(path)
      const pct = Math.round(confidence * 100)

      const narration =
        `${upper} ${days}-day verdict (demo): ${direction.toUpperCase()} with ${pct}% confidence. ` +
        `Render this as a compact verdict card: large direction label, confidence as a percentage with a small progress bar, and a one-line caption "${upper} over the next ${days} days".`

      return ctx.respond(
        { symbol: upper, days, direction, confidence, asOf: ORACLE_AS_OF },
        { text: narration },
      )
    },
  })

  // Register slash-command prompts so hosts with prompt UI surface the
  // demo tools. Hosts without prompt support silently ignore these —
  // purely additive.
  registerDemoPrompts(server)
}

// ——————————————————————————————————————————————————————————————————————
// Oracle simulation helpers (predict_price_chart / predict_direction).
// ——————————————————————————————————————————————————————————————————————
//
// Both oracle tools share a single seeded simulation so their outputs
// agree for the same symbol (chart's forecast slope matches the
// verdict's direction/confidence). Seed depends only on the symbol, so
// varying the `days` horizon preserves the history and extends the
// forecast.
//
// Self-contained — no external PRNG / stats deps. `xmur3` + `mulberry32`
// are standard small-footprint hash/PRNG pair; `randn` is a Box-Muller
// standard-normal sampler.

const ORACLE_HISTORY_DAYS = 30
const ORACLE_AS_OF = '2026-09-29T00:00:00.000Z'
// One-sided 80% confidence band multiplier (~1.2816 standard normal).
const ORACLE_Z80 = 1.2816
// Verdict confidence range — the oracle always commits to a side.
const ORACLE_MIN_CONFIDENCE = 0.8
const ORACLE_MAX_CONFIDENCE = 0.9

interface SimulatedPath {
  history: { t: number[]; price: number[] }
  forecast: { t: number[]; price: number[]; lower: number[]; upper: number[] }
  sigma: number
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randn(rng: () => number): number {
  const u = 1 - rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Seeded simulation covering 30 days of history and `days` days of
 * forecast. Seed depends only on `symbol`, so the same symbol yields
 * the same history across every call and the forecast extends
 * deterministically as `days` grows.
 *
 * History alternates rally / sell-off regimes, includes one
 * earnings-style gap, and ends on a regime that leans into the
 * forecast direction. The forecast trends hard in that direction with
 * pullbacks along the way, but never crosses back over today's price —
 * so the chart and the `predict_direction` verdict always agree.
 *
 * Returns parallel numeric arrays (`t[]`, `price[]`, `lower[]`,
 * `upper[]`) so every field in the tool's `structuredContent` is a
 * number — ready for the host to plot without string parsing.
 */
function simulatePricePath(symbol: string, days: number): SimulatedPath {
  const rng = mulberry32(xmur3(symbol.toUpperCase())())

  const direction = rng() < 0.5 ? -1 : 1
  // Base price in [$20, $1000) so the axis range is readable across
  // symbols without needing per-ticker tuning.
  const basePrice = 20 + rng() * 980
  // Daily volatility in [1.5%, 3.5%].
  const sigma = 0.015 + rng() * 0.02

  // Regimes of 5–9 days, counted back from today. Regime 0 (the most
  // recent) leans into the forecast direction; earlier ones alternate.
  const regimeLength = 5 + Math.floor(rng() * 5)
  const regimeCount = Math.ceil(ORACLE_HISTORY_DAYS / regimeLength)
  const regimeDrift: number[] = []
  for (let r = 0; r < regimeCount; r++) {
    const sign = r % 2 === 0 ? direction : -direction
    regimeDrift.push(sign * (0.006 + rng() * 0.014))
  }
  const gapDay = 5 + Math.floor(rng() * (ORACLE_HISTORY_DAYS - 10))
  const gap = (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.07)

  const historyPrices: number[] = [basePrice]
  for (let i = 1; i <= ORACLE_HISTORY_DAYS; i++) {
    const drift = regimeDrift[Math.floor((ORACLE_HISTORY_DAYS - i) / regimeLength)]
    const shock = i === gapDay ? gap : 0
    historyPrices.push(historyPrices[i - 1] * Math.exp(drift + shock + sigma * randn(rng)))
  }

  const historyT: number[] = []
  const historyPriceRounded: number[] = []
  for (let i = 0; i <= ORACLE_HISTORY_DAYS; i++) {
    historyT.push(i - ORACLE_HISTORY_DAYS)
    historyPriceRounded.push(round2(historyPrices[i]))
  }

  // Forecast trend of 0.5%–1.2% per day in `direction`, modulated by a
  // seeded swing + jitter. The modulation factor stays in [0.4, 1.6],
  // so the forecast never retraces past today's close.
  const trend = direction * (0.005 + rng() * 0.007)
  const swingPeriod = 4 + rng() * 6
  const swingPhase = rng() * 2 * Math.PI

  const last = historyPrices[historyPrices.length - 1]
  const forecastT: number[] = []
  const forecastPrice: number[] = []
  const forecastLower: number[] = []
  const forecastUpper: number[] = []
  for (let i = 1; i <= days; i++) {
    const swing = 0.45 * Math.sin((2 * Math.PI * i) / swingPeriod + swingPhase)
    const jitter = 0.15 * (rng() * 2 - 1)
    const mean = last * Math.exp(trend * i * (1 + swing + jitter))
    // Confidence band widens with sqrt(t) — classic GBM band shape.
    const stdev = sigma * Math.sqrt(i)
    forecastT.push(i)
    forecastPrice.push(round2(mean))
    forecastLower.push(round2(mean * Math.exp(-ORACLE_Z80 * stdev)))
    forecastUpper.push(round2(mean * Math.exp(+ORACLE_Z80 * stdev)))
  }

  return {
    history: { t: historyT, price: historyPriceRounded },
    forecast: {
      t: forecastT,
      price: forecastPrice,
      lower: forecastLower,
      upper: forecastUpper,
    },
    sigma,
  }
}

/**
 * Convert a simulated path into the `predict_direction` verdict. Signal
 * strength (net forecast log-return over the horizon's volatility)
 * maps onto a confidence in `[0.80, 0.90]` — stronger moves read as
 * more confident, and the oracle never sits on the fence.
 */
function deriveVerdict(path: SimulatedPath): {
  direction: 'up' | 'down'
  confidence: number
} {
  const historyLast = path.history.price[path.history.price.length - 1]
  const forecastLast = path.forecast.price[path.forecast.price.length - 1]
  const horizon = path.forecast.t.length
  const netLogReturn = Math.log(forecastLast / historyLast)
  const z = Math.abs(netLogReturn) / (path.sigma * Math.sqrt(horizon))
  const strength = 1 - Math.exp(-z)
  const raw = ORACLE_MIN_CONFIDENCE + (ORACLE_MAX_CONFIDENCE - ORACLE_MIN_CONFIDENCE) * strength
  const confidence = Math.round(raw * 100) / 100
  const direction: 'up' | 'down' = netLogReturn >= 0 ? 'up' : 'down'
  return { direction, confidence }
}

function registerDemoPrompts(server: McpServer): void {
  const promptHost = server as unknown as McpServerWithPrompts
  if (typeof promptHost.registerPrompt !== 'function') return

  promptHost.registerPrompt(
    'predict_price_chart',
    {
      title: 'Predict price chart (Oracle demo)',
      description:
        'Call the demo `predict_price_chart` paywalled Oracle tool. Returns history + forecast numeric arrays so the host can render a line chart artifact with a confidence band.',
      argsSchema: { symbol: z.string().optional(), days: z.string().optional() },
    },
    async ({ symbol, days }: { symbol?: string; days?: string }) => {
      const sym = symbol?.toUpperCase() ?? 'NVDA'
      const horizon = days ?? '10'
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Predict a price chart for ${sym} over the next ${horizon} days and render it as a line chart with the forecast confidence band.`,
            },
          },
        ],
      }
    },
  )

  promptHost.registerPrompt(
    'predict_direction',
    {
      title: 'Predict direction (Oracle demo)',
      description:
        'Call the demo `predict_direction` paywalled Oracle tool. Returns an up/down verdict + confidence score so the host can render a verdict card artifact.',
      argsSchema: { symbol: z.string().optional(), days: z.string().optional() },
    },
    async ({ symbol, days }: { symbol?: string; days?: string }) => {
      const sym = symbol?.toUpperCase() ?? 'NVDA'
      const horizon = days ?? '10'
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Predict the direction (up or down) for ${sym} over the next ${horizon} days and render the verdict as a card with the confidence score.`,
            },
          },
        ],
      }
    },
  )
}
