/**
 * Broader regression guard for `@solvapay/server`'s edge entrypoint.
 *
 * Unlike `__tests__/edge-exports.unit.test.ts` (which scopes to the
 * `*Core` route helpers consumed by `@solvapay/fetch`), this suite
 * imports every symbol `@solvapay/mcp-core` / `@solvapay/mcp-fetch`
 * pulls through their top-level `@solvapay/server` import and asserts
 * each one resolves on `./edge`. Runtimes that set the `deno`,
 * `edge-light`, or `worker` export conditions (Deno Deploy, Vercel
 * Edge, Cloudflare Workers, Supabase Edge) resolve the default
 * specifier to `dist/edge.js`, so a symbol that's only re-exported
 * from `src/index.ts` (the Node entry) boot-crashes the adapter with
 * `does not provide an export named '<name>'`.
 *
 * The original Goldberg boot-crash was exactly this class of bug:
 * `@solvapay/mcp-core@0.2` started importing `buildNudgeMessage` +
 * `isPaywallStructuredContent` from `@solvapay/server`; those lived
 * only in `src/index.ts`, so Deno's `deno` condition resolved to
 * `dist/edge.js` and crashed at module-load time. This smoke test is
 * the guard that fires before the next regression makes it to a
 * release.
 */
import { describe, expect, it } from 'vitest'
import * as edgeEntry from '../edge'

// The canonical list of symbols that MUST resolve on the edge
// entrypoint. Covers:
//  - Paywall state engine (`classifyPaywallState`, `buildGateMessage`,
//    `buildNudgeMessage`) imported by `@solvapay/mcp-core/payable-handler`.
//  - Runtime type guard `isPaywallStructuredContent` used by
//    `@solvapay/mcp-core/types/paywall`.
//  - `PaywallError` class used for `instanceof` checks and OAuth
//    bridge error normalisation.
//  - Factory / client helpers (`createSolvaPay`, `createSolvaPayClient`,
//    `paywallErrorToClientPayload`) consumed by edge MCP adapters
//    straight from `@solvapay/server`.
//  - `verifyWebhook` (edge variant is async; `index.ts` is sync).
//  - `withRetry` utility.
//  - `*Core` route helpers (overlap with the existing test — kept here
//    so the two edge smoke tests cover the same surface).
const REQUIRED_FUNCTIONS: ReadonlyArray<keyof typeof edgeEntry> = [
  // Paywall state engine.
  'buildGateMessage',
  'buildNudgeMessage',
  'classifyPaywallState',
  // Runtime type guards.
  'isPaywallStructuredContent',
  // Factory + client creation.
  'createSolvaPay',
  'createSolvaPayClient',
  // Error helpers.
  'paywallErrorToClientPayload',
  // Webhook verification.
  'verifyWebhook',
  // Retry utility.
  'withRetry',
  // Route helpers — the surface the original `edge-exports.unit.test`
  // asserts on, included here so the plan's single smoke test covers
  // every import-path the edge consumers rely on.
  'getAuthenticatedUserCore',
  'syncCustomerCore',
  'getCustomerBalanceCore',
  'createPaymentIntentCore',
  'createTopupPaymentIntentCore',
  'processPaymentIntentCore',
  'createCheckoutSessionCore',
  'createCustomerSessionCore',
  'cancelPurchaseCore',
  'reactivatePurchaseCore',
  'activatePlanCore',
  'checkPurchaseCore',
  'trackUsageCore',
  'getUsageCore',
  'listPlansCore',
  'getMerchantCore',
  'getProductCore',
  'getPaymentMethodCore',
  'isErrorResult',
  'handleRouteError',
]

// Class-valued symbols (both `typeof === 'function'` and
// `instanceof Function`) are exported alongside the pure functions
// above. `PaywallError` specifically — the edge bundle MUST expose it
// so consumers can do `err instanceof PaywallError` without importing
// a second path.
const REQUIRED_CLASSES: ReadonlyArray<keyof typeof edgeEntry> = ['PaywallError']

describe('@solvapay/server edge entrypoint surface', () => {
  it.each(REQUIRED_FUNCTIONS)('exports %s as a function', name => {
    expect(edgeEntry).toHaveProperty(name)
    expect(typeof edgeEntry[name]).toBe('function')
  })

  it.each(REQUIRED_CLASSES)('exports %s as a class / constructor', name => {
    expect(edgeEntry).toHaveProperty(name)
    expect(typeof edgeEntry[name]).toBe('function')
    // Constructors are callable; assert the symbol is at least a
    // function-valued export so `instanceof` works on the edge bundle.
    expect(edgeEntry[name]).toBeInstanceOf(Function)
  })

  it('keeps the edge + node surfaces in sync for every required symbol', async () => {
    const nodeEntry = await import('../index')
    const nodeExports = new Set(Object.keys(nodeEntry))
    const missingOnNode = REQUIRED_FUNCTIONS.filter(name => !nodeExports.has(name as string))
    // Either side missing a symbol is a red flag — `index.ts`
    // regressions are even likelier to slip past local testing than
    // `edge.ts` regressions because most contributors test against
    // Node.
    expect(missingOnNode).toEqual([])
  })
})
