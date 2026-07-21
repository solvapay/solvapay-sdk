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

const { verifyWebhook } = await import(serverEdge)
const { MCP_TOOL_NAMES } = await import(mcpCore)

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

console.log('OK: deno-edge-smoke verifyWebhook + MCP_TOOL_NAMES')
console.log(`  event.id=${event.id}`)
console.log(`  MCP_TOOL_NAMES.keys=${toolCount}`)
