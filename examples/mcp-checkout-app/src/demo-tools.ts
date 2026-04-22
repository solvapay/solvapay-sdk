/**
 * Example-local paywalled data tools for `mcp-checkout-app`.
 *
 * These tools illustrate how a "data MCP" server wraps its business
 * logic with the SolvaPay usage-based paywall. They are **not** part of
 * any `@solvapay/*` package — they consume `registerPayable` exactly
 * the way a third-party integrator would.
 *
 * Both return deterministic stub payloads so the demo is self-contained:
 * no external dependencies, keys, or rate limits. Swap the handlers for
 * real ones in a few lines to turn this into a production server.
 *
 * Gate with the `DEMO_TOOLS` env var (defaults to `true` in dev; set to
 * `"false"` when copying this example to your own repo as a template).
 */

import { z } from 'zod'
import type { AdditionalToolsContext } from '@solvapay/mcp-sdk'
import type { ResponseContext } from '@solvapay/mcp'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

interface McpServerWithPrompts {
  registerPrompt: McpServer['registerPrompt']
}

/**
 * True when the `DEMO_TOOLS` env var is absent or set to anything other
 * than the literal string `"false"`. Kept as a module-level helper so
 * `server.ts` can guard the wiring the same way the smoke test and the
 * README recipe document.
 */
export function demoToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_TOOLS !== 'false'
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
    handler: async ({ query }: { query: string }) => ({
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
    handler: async ({ symbol }: { symbol: string }) => {
      const upper = symbol.toUpperCase()
      return {
        symbol: upper,
        price: 123.45,
        currency: 'USD',
        asOf: '2026-01-01T00:00:00.000Z',
      }
    },
  })

  // Third demo tool exercises the V1 `ctx.respond()` surface — the
  // hero flow for the ctx-respond-v1 spec.
  //
  // Two paths:
  //  1. Mode 1 (silent) when the customer has comfortable balance.
  //  2. Mode 2 (nudge) when the customer is close to running out;
  //     attaches a `low-balance` upsell strip to the successful
  //     response.
  //
  // Also includes `options.units` to demonstrate forward-compatible
  // handler code. V1 silently ignores the field; V1.1 will thread it
  // into `trackUsage` without requiring any merchant code changes.
  registerPayable('query_sales_trends', {
    title: 'Query sales trends (demo)',
    description:
      'Demo data tool that exercises the `ctx.respond()` API: returns deterministic sales rows for a date range and, when the customer is low on credits, attaches a `low-balance` upsell nudge to the success response. Use `/query_sales_trends` to try the nudge flow.',
    schema: { range: z.string().min(1) },
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (
      { range }: { range: string },
      ctx: ResponseContext,
    ) => {
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
            message: 'Running low on credits — top up to keep querying.',
          },
        },
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
}
