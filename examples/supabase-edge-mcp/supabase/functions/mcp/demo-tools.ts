/**
 * Example-local paywalled data tools for `supabase-edge-mcp`.
 *
 * Byte-for-byte copy of `mcp-checkout-app/src/demo-tools.ts` with one
 * runtime-neutral tweak: `demoToolsEnabled` reads the env flag through
 * a plain `Record<string, string | undefined>` default so the file
 * compiles under both Node (via `process.env`) and Deno (via
 * `Deno.env.toObject()`). The rest — the tools, the paywalled
 * handlers, the seeded oracle simulation — is production-identical
 * between the two examples; the only thing that changes between
 * runtimes is the HTTP handler wrapping them.
 *
 * These tools illustrate how a "data MCP" server wraps its business
 * logic with the SolvaPay usage-based paywall. They are **not** part of
 * any `@solvapay/*` package — they consume `registerPayable` exactly
 * the way a third-party integrator would.
 *
 * All tools return deterministic stub payloads so the demo is
 * self-contained: no external dependencies, keys, or rate limits. Swap
 * the handlers for real ones in a few lines to turn this into a
 * production server.
 *
 * Single rendering strategy — host renders the data:
 *
 * The merchant's data rides on `structuredContent` so capable hosts
 * (Claude artifacts, ChatGPT Apps, MCP Inspector) render it natively —
 * a chat bubble for `search_knowledge`, a line-chart artifact for
 * `predict_price_chart`, a verdict card for `predict_direction`, and
 * so on. The SolvaPay widget is reserved for the three intent tools
 * (`upgrade`, `manage_account`, `topup`) where the user deliberately
 * asked for a checkout / account / topup UX.
 *
 * Paywall responses on exhaustion are plain text narrations that name
 * the recovery intent tool and inline `gate.checkoutUrl` for
 * terminal-first hosts. No iframe opens for a gate — the LLM reads
 * the narration and calls the recovery tool, which mounts the widget.
 *
 * Gate with the `DEMO_TOOLS` env var (defaults to `true` in dev; set to
 * `"false"` when copying this example to your own repo as a template).
 */

import { z } from 'zod'
import type { AdditionalToolsContext } from '@solvapay/mcp'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

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
 * Registers two paywalled demo tools + their slash-command prompts on the
 * server provided by `createSolvaPayMcpServer`'s `additionalTools` hook.
 *
 * Tool shape mirrors
 * `examples/checkout-demo/app/components/UsageSimulator.tsx`: each call
 * consumes one unit of usage; when the customer runs out, the tool
 * returns a paywall bootstrap instead of results (handled entirely by
 * `solvaPay.payable().mcp()` inside `registerPayable`).
 */
export function registerDemoTools(ctx: AdditionalToolsContext): void {
  const { registerPayable, server } = ctx

  registerPayable('search_knowledge', {
    title: 'Search knowledge base (demo)',
    description:
      'Demo data tool — returns deterministic fake snippets for a query. Wrapped with `solvaPay.payable.mcp()` so each call consumes 1 unit of usage; when the customer runs out, the tool returns a paywall bootstrap instead of results. Pair with `/search_knowledge` for a one-keystroke exercise of the paywall.',
    schema: { query: z.string().min(1) },
    // Explicit for docs clarity; `registerPayable` would otherwise
    // default to `{ readOnlyHint: true, openWorldHint: true }` — the
    // same 80% case most paywalled data tools land on.
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ query }, ctx) =>
      ctx.respond({
        query,
        results: [
          { id: 'stub-1', title: `Why ${query} matters`, snippet: `Lorem ipsum about ${query}.` },
          { id: 'stub-2', title: `Getting started with ${query}`, snippet: 'Dolor sit amet.' },
          { id: 'stub-3', title: `${query} in depth`, snippet: 'Consectetur adipiscing elit.' },
        ],
      }),
  })

  registerPayable('get_market_quote', {
    title: 'Get market quote (demo)',
    description:
      'Demo data tool — returns a deterministic fake quote for a ticker symbol. Same paywall semantics as `search_knowledge`: one unit of usage per call, and the gate response opens the embedded top-up iframe. Use `/get_market_quote` to try the paywall on a second tool.',
    schema: { symbol: z.string().min(1).max(8) },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ symbol }, ctx) => {
      const upper = symbol.toUpperCase()
      return ctx.respond({
        symbol: upper,
        price: 123.45,
        currency: 'USD',
        asOf: '2026-01-01T00:00:00.000Z',
      })
    },
  })

  // Third demo tool exercises the text-only nudge suffix on
  // `ctx.respond()`. When the customer is low on credits the nudge
  // message is appended to `content[0].text` as a plain-text
  // suffix — no widget surface, no `structuredContent` switch.
  //
  // Also includes `options.units` to demonstrate forward-compatible
  // handler code. V1 silently ignores the field; V1.1 will thread it
  // into `trackUsage` without requiring any merchant code changes.
  registerPayable('query_sales_trends', {
    title: 'Query sales trends (demo)',
    description:
      'Demo data tool that exercises the `ctx.respond()` API: returns deterministic sales rows for a date range. When the customer is low on credits, the response `content[0].text` carries a plain-text `low-balance` nudge pointing at the `topup` intent tool — hosts render it inline with the data, no widget iframe.',
    schema: { range: z.string().min(1) },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async ({ range }, ctx) => {
      const results = buildDeterministicRows(range)

      // Balance threshold is deliberately chatty so the demo can cross
      // it after a handful of calls against a starter top-up.
      const LOW_BALANCE_CENTS = 1000
      const isLowBalance = ctx.customer.balance < LOW_BALANCE_CENTS

      if (!isLowBalance) {
        return ctx.respond({ range, results }, { units: results.length })
      }

      return ctx.respond(
        { range, results },
        {
          units: results.length,
          nudge: {
            kind: 'low-balance',
            message:
              'Running low on credits — call the `topup` tool to add more.',
          },
        },
      )
    },
  })

  // Oracle tools return pure numeric data via `ctx.respond(payload)`
  // so capable MCP hosts (Claude artifacts) render a line chart /
  // verdict card artifact straight off `structuredContent`. Paywall
  // exhaustion ships a text-only narration via `content[0].text` —
  // no iframe opens for a gate, the LLM reads the copy and calls the
  // `upgrade` / `topup` intent tool which mounts the widget.
  registerPayable('predict_price_chart', {
    title: 'Predict price chart (Oracle demo)',
    description:
      'Returns recent daily price history and a forecast over the requested `days` horizon with an 80% confidence band; always renders as an interactive line chart artifact in the host. Parallel numeric arrays (history.t/price, forecast.t/price/lower/upper) so any chart library binds directly. 1 credit per call; paywall opens when out of balance.',
    schema: {
      symbol: z.string().min(1).max(8),
      days: z.number().int().min(1).max(60).default(10),
    },
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
      'Returns an up/down verdict with a confidence score in [0, 1] for a ticker over the requested horizon; always renders as a compact verdict card artifact in the host. Same seeded model as `predict_price_chart`, so the verdict matches the chart for the same symbol. 1 credit per call; paywall opens when out of balance.',
    schema: {
      symbol: z.string().min(1).max(8),
      days: z.number().int().min(1).max(60).default(10),
    },
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

/**
 * Deterministic sales-trend rows so `query_sales_trends` is self-contained
 * and doesn't depend on any backend data source. Real integrations swap
 * this for a database / warehouse call.
 */
function buildDeterministicRows(range: string): Array<{
  date: string
  units: number
  revenue: number
}> {
  const base = range.length
  return [
    { date: '2026-01-01', units: 12 + base, revenue: 1_234 + base * 10 },
    { date: '2026-01-02', units: 15 + base, revenue: 1_512 + base * 10 },
    { date: '2026-01-03', units: 18 + base, revenue: 1_789 + base * 10 },
    { date: '2026-01-04', units: 14 + base, revenue: 1_401 + base * 10 },
  ]
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
// standard-normal sampler; `erf` is the Abramowitz & Stegun approximation
// used for the confidence CDF.

const ORACLE_HISTORY_DAYS = 30
const ORACLE_AS_OF = '2026-04-24T00:00:00.000Z'
// One-sided 80% confidence band multiplier (~1.2816 standard normal).
const ORACLE_Z80 = 1.2816

interface SimulatedPath {
  history: { t: number[]; price: number[] }
  forecast: { t: number[]; price: number[]; lower: number[]; upper: number[] }
  sigma: number
  drift: number
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

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * ax)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/**
 * Seeded geometric-Brownian-motion walk covering 30 days of history
 * and `days` days of forecast. Seed depends only on `symbol`, so the
 * same symbol yields the same history across every call and the
 * forecast extends deterministically as `days` grows.
 *
 * Returns parallel numeric arrays (`t[]`, `price[]`, `lower[]`,
 * `upper[]`) so every field in the tool's `structuredContent` is a
 * number — ready for the host to plot without string parsing.
 */
function simulatePricePath(symbol: string, days: number): SimulatedPath {
  const rng = mulberry32(xmur3(symbol.toUpperCase())())

  // Base price in [$20, $1000) so the axis range is readable across
  // symbols without needing per-ticker tuning.
  const basePrice = 20 + rng() * 980
  // Daily drift in [-0.2%, +0.2%] — enough to bias the forecast
  // direction without dominating the noise term.
  const drift = (rng() - 0.5) * 0.004
  // Daily volatility in [1%, 3%].
  const sigma = 0.01 + rng() * 0.02

  const historyPrices: number[] = [basePrice]
  for (let i = 1; i <= ORACLE_HISTORY_DAYS; i++) {
    const prev = historyPrices[i - 1]
    historyPrices.push(prev * Math.exp(drift + sigma * randn(rng)))
  }

  const historyT: number[] = []
  const historyPriceRounded: number[] = []
  for (let i = 0; i <= ORACLE_HISTORY_DAYS; i++) {
    historyT.push(i - ORACLE_HISTORY_DAYS)
    historyPriceRounded.push(round2(historyPrices[i]))
  }

  const last = historyPrices[historyPrices.length - 1]
  const forecastT: number[] = []
  const forecastPrice: number[] = []
  const forecastLower: number[] = []
  const forecastUpper: number[] = []
  for (let i = 1; i <= days; i++) {
    const mean = last * Math.exp(drift * i)
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
    drift,
  }
}

/**
 * Convert a simulated path into the `predict_direction` verdict. Uses
 * the one-sided normal CDF of the forecast's net log-return to map the
 * signal strength onto a confidence in `[0.5, 0.95]`.
 */
function deriveVerdict(path: SimulatedPath): {
  direction: 'up' | 'down'
  confidence: number
} {
  const historyLast = path.history.price[path.history.price.length - 1]
  const forecastLast = path.forecast.price[path.forecast.price.length - 1]
  const horizon = path.forecast.t.length
  const netLogReturn = Math.log(forecastLast / historyLast)
  const totalStdev = path.sigma * Math.sqrt(horizon)
  const z = totalStdev > 0 ? Math.abs(netLogReturn) / totalStdev : 0
  // Φ(z) gives the one-sided probability the true mean is on this side
  // of zero under a normal prior; clipped to [0.5, 0.95] so the card
  // never over-promises.
  const raw = 0.5 + 0.5 * erf(z / Math.SQRT2)
  const confidence = Math.round(clip(raw, 0.5, 0.95) * 100) / 100
  const direction: 'up' | 'down' = netLogReturn >= 0 ? 'up' : 'down'
  return { direction, confidence }
}

function registerDemoPrompts(server: McpServer): void {
  const promptHost = server as unknown as McpServerWithPrompts
  if (typeof promptHost.registerPrompt !== 'function') return

  promptHost.registerPrompt(
    'search_knowledge',
    {
      title: 'Search knowledge (demo)',
      description:
        'Call the demo `search_knowledge` paywalled tool. Each call consumes 1 credit; when you run out, the SolvaPay paywall opens.',
      argsSchema: { query: z.string().optional() },
    },
    async ({ query }: { query?: string }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: query
              ? `Search the knowledge base for: ${query}`
              : 'Search the knowledge base for something you care about.',
          },
        },
      ],
    }),
  )

  promptHost.registerPrompt(
    'get_market_quote',
    {
      title: 'Get market quote (demo)',
      description:
        'Call the demo `get_market_quote` paywalled tool. Each call consumes 1 credit; when you run out, the SolvaPay paywall opens.',
      argsSchema: { symbol: z.string().optional() },
    },
    async ({ symbol }: { symbol?: string }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: symbol
              ? `Get the current market quote for ${symbol.toUpperCase()}.`
              : 'Get the current market quote for a ticker symbol.',
          },
        },
      ],
    }),
  )

  promptHost.registerPrompt(
    'query_sales_trends',
    {
      title: 'Query sales trends (demo)',
      description:
        'Call the demo `query_sales_trends` paywalled tool. Exercises `ctx.respond()` — a low balance triggers a `low-balance` upsell nudge attached to the success response.',
      argsSchema: { range: z.string().optional() },
    },
    async ({ range }: { range?: string }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: range
              ? `Query sales trends for ${range}.`
              : 'Query sales trends for the last 7 days.',
          },
        },
      ],
    }),
  )

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
