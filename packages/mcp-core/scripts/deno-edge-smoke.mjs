/**
 * Deno smoke: import built `@solvapay/server` edge entry + `@solvapay/mcp-core`,
 * verify a frozen webhook through the WASM edge facade, and call one mcp-core
 * pure helper so missing-edge-export / WASM asset failures surface here.
 *
 * Permissions: --allow-read (local committed WASM under the workspace pkg/).
 *
 * Usage (from repo root, after pnpm build:packages):
 *   deno run --allow-read=packages,rust/bindings/wasm,node_modules \
 *     packages/mcp-core/scripts/deno-edge-smoke.mjs
 */
const repoRoot = new URL('../../..', import.meta.url)
const serverEdge = new URL('packages/server/dist/edge.js', repoRoot).href
const mcpCore = new URL('packages/mcp-core/dist/index.js', repoRoot).href

const { verifyWebhook, classifyPaywallState, buildPaywallGate } = await import(serverEdge)
const { MCP_TOOL_NAMES, getMcpToolNamesTable } = await import(mcpCore)

const FIXTURE_BODY = JSON.stringify({
  type: 'purchase.created',
  id: 'evt_fixture_1',
  created: 1782864000,
  api_version: '2025-10-01',
  data: { object: { id: 'pur_fixture_1' }, previous_attributes: null },
  livemode: false,
  request: { id: null, idempotency_key: null },
})
const FIXTURE_SECRET = 'whsec_test_fixture_secret'
const FIXTURE_SIGNATURE =
  't=1782864000,v1=04834cba2241fe998a4fb5b8bb4632b2c2e18a3e330dba1905f62b365521ca82'

// Freeze clock for the edge facade (uses Date.now).
const RealDate = Date
globalThis.Date = class extends RealDate {
  static now() {
    return 1_782_864_000 * 1000
  }
}

const event = await verifyWebhook({
  body: FIXTURE_BODY,
  signature: FIXTURE_SIGNATURE,
  secret: FIXTURE_SECRET,
})

if (event.type !== 'purchase.created' || event.id !== 'evt_fixture_1') {
  throw new Error(`unexpected event: ${JSON.stringify(event)}`)
}

const toolCount = MCP_TOOL_NAMES && typeof MCP_TOOL_NAMES === 'object'
  ? Object.keys(MCP_TOOL_NAMES).length
  : 0
if (toolCount < 1) {
  throw new Error('MCP_TOOL_NAMES missing from mcp-core')
}

// Sync edge surfaces. The webhook above awaited WASM warm-up, so these route
// through the installed WASM sync dispatch (Step 38R-c/d) — a throw here means
// the edge install / initSync wiring is broken.
const state = classifyPaywallState(null)
if (!state || state.kind !== 'upgrade_required') {
  throw new Error(`classifyPaywallState returned unexpected value: ${JSON.stringify(state)}`)
}

const gate = buildPaywallGate('prod_smoke', {
  remaining: 0,
  withinLimits: false,
  plan: '',
  checkoutUrl: 'https://checkout.example/smoke',
})
if (gate.product !== 'prod_smoke' || gate.kind !== 'payment_required') {
  throw new Error(`buildPaywallGate returned unexpected gate: ${JSON.stringify(gate)}`)
}

// mcp-core sync dispatch (ambient WASM API published by the edge entry).
const toolTable = getMcpToolNamesTable()
if (!toolTable || Object.keys(toolTable).length !== toolCount) {
  throw new Error('getMcpToolNamesTable did not match MCP_TOOL_NAMES')
}

console.log('OK: deno-edge-smoke verifyWebhook + sync edge surfaces + MCP_TOOL_NAMES')
console.log(`  event.id=${event.id}`)
console.log(`  paywall.state=${state.kind}`)
console.log(`  gate.kind=${gate.kind}`)
console.log(`  MCP_TOOL_NAMES.keys=${toolCount}`)
