#!/usr/bin/env node
/* global console, process */
/**
 * `verify.mjs <worker-url>` — contract checks against a running worker.
 *
 * Read-only. Asserts the worker looks like a SolvaPay MCP server:
 *   - `/.well-known/oauth-protected-resource` returns the expected
 *     JSON shape.
 *   - `/.well-known/oauth-authorization-server` returns the expected
 *     JSON shape.
 *   - `tools/list` returns the intent tools (`account`, `activate_plan`)
 *     plus the generated tools, with
 *     UI-only tools hidden.
 *   - When at least one paid tool is registered: call it past the
 *     paywall and assert text-only narration in `content[0].text` (no
 *     iframe, no structured UI payload on the gate).
 *
 * Output: JSON pass/fail/skipped map on stdout. Exit code 0 if no
 * check failed (skipped + passed are fine), 1 otherwise.
 */

import { readFileSync } from 'node:fs'
import {
  rpc,
  listTools,
  callTool,
  getJson,
  listResources,
  readResource,
  RpcError,
} from './lib/mcp-client.mjs'

const INTENT_TOOLS = ['account', 'activate_plan']
const UI_TOOL_HINTS = [
  'create_payment_intent',
  'create_topup_payment_intent',
  'create_checkout_session',
]

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workerUrl) {
    console.error('Usage: verify.mjs <worker-url> [--credentials-file <path>] [--skip-oauth]')
    process.exit(2)
  }

  // `--credentials-file` accepts the JSON file written by
  // `mcpjam oauth login --credentials-out`. When present, the new
  // `merchantBootstrap` check actually exercises the SolvaPay layer
  // by calling `account` with a bearer token. Without it, the
  // check skips so existing CI pipelines that don't have credentials
  // wired still see a green build.
  let bearerToken
  if (args.credentialsFile) {
    try {
      const raw = readFileSync(args.credentialsFile, 'utf8')
      const parsed = JSON.parse(raw)
      bearerToken = typeof parsed?.accessToken === 'string' ? parsed.accessToken : undefined
    } catch (err) {
      console.error(
        `Failed to read --credentials-file (${args.credentialsFile}): ${err?.message ?? err}`,
      )
      process.exit(2)
    }
    if (!bearerToken) {
      console.error(
        `--credentials-file (${args.credentialsFile}) is missing \`accessToken\`. Re-run \`mcpjam oauth login --credentials-out <file>\` and retry.`,
      )
      process.exit(2)
    }
  }

  const rpcOptions = bearerToken ? { bearerToken } : {}

  const base = args.workerUrl.replace(/\/$/, '')
  const checks = {}

  if (args.skipOauth) {
    checks.oauthProtectedResource = {
      status: 'skipped',
      reason: '--skip-oauth: local stub / no authorization server',
    }
    checks.oauthAuthorizationServer = {
      status: 'skipped',
      reason: '--skip-oauth: local stub / no authorization server',
    }
  } else {
    checks.oauthProtectedResource = await run(async () => {
      const meta = await getJson(`${base}/.well-known/oauth-protected-resource`)
      assert(typeof meta.resource === 'string', 'resource must be a string')
      assert(
        Array.isArray(meta.authorization_servers) && meta.authorization_servers.length > 0,
        'authorization_servers must be a non-empty array',
      )
      return { resource: meta.resource, authServer: meta.authorization_servers[0] }
    })

    checks.oauthAuthorizationServer = await run(async () => {
      const meta = await getJson(`${base}/.well-known/oauth-authorization-server`)
      assert(typeof meta.issuer === 'string', 'issuer must be a string')
      assert(
        typeof meta.authorization_endpoint === 'string',
        'authorization_endpoint must be a string',
      )
      assert(typeof meta.token_endpoint === 'string', 'token_endpoint must be a string')
      return { issuer: meta.issuer }
    })
  }

  const toolsResult = await runToolsListCheck(base, rpcOptions)
  checks.toolsList = toolsResult

  checks.widgetResource = await runWidgetResourceCheck(base, rpcOptions)
  checks.bootstrapResource = await runBootstrapResourceCheck(base, rpcOptions)

  // `paywallGate` needs credentials: `tools/call` is gated under the
  // SDK default `requireAuth: true` even though discovery is anonymous.
  // Without `--credentials-file`, skip the gate check — that's expected,
  // not a worker bug. With credentials, call paid tools and look for
  // the SolvaPay paywall envelope.
  const candidates =
    toolsResult.status === 'passed' && Array.isArray(toolsResult.value.names)
      ? findToolCandidates(toolsResult.value.names)
      : []
  checks.paywallGate = !bearerToken
    ? {
        status: 'skipped',
        reason:
          'tools/call requires bearer auth; pass `--credentials-file <path>` from `mcpjam oauth login --credentials-out` to exercise the paywall gate',
      }
    : await runPaywallGateCheck(base, candidates, rpcOptions)

  // `merchantBootstrap` exercises the SolvaPay bootstrap path by
  // calling `account` (an intent tool, always registered) and
  // asserting the response is not an error envelope. Without a bearer
  // token, the call would gate at the HTTP layer — so it skips. With
  // a bearer token, a 500 or text containing `"bootstrap"` is a real
  // failure (typically `Provider not found` post-deploy).
  checks.merchantBootstrap = bearerToken
    ? await runMerchantBootstrapCheck(base, rpcOptions)
    : {
        status: 'skipped',
        reason: 'no --credentials-file passed; cannot exercise SolvaPay bootstrap',
      }

  const warnings = collectWarnings(checks)
  const summary = {
    workerUrl: base,
    checks,
    paidPathVerification: {
      paywallGate: checks.paywallGate.status,
      merchantBootstrap: checks.merchantBootstrap.status,
    },
    warnings,
    overall: Object.values(checks).every(c => c.status !== 'failed') ? 'passed' : 'failed',
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(summary.overall === 'passed' ? 0 : 1)
}

function parseArgs(argv) {
  let workerUrl
  let credentialsFile
  let skipOauth = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--credentials-file') {
      credentialsFile = argv[++i]
    } else if (arg === '--skip-oauth') {
      skipOauth = true
    } else if (!workerUrl) {
      workerUrl = arg
    }
  }
  return { workerUrl, credentialsFile, skipOauth }
}

async function run(fn) {
  try {
    const value = await fn()
    return { status: 'passed', value }
  } catch (err) {
    return {
      status: 'failed',
      error: err.message ?? String(err),
      info: err instanceof RpcError ? err.info : undefined,
    }
  }
}

/**
 * Contract for `tools/list`: anonymous discovery must succeed (SDK
 * `requireAuth` gates only `tools/call`). Assert intent tools present
 * and no UI-only tools leak into the text catalog.
 *
 * A 401 on `tools/list` is a failure — the worker is incorrectly
 * gating discovery (outdated SDK or a fully-private origin).
 */
async function runToolsListCheck(base, rpcOptions = {}) {
  try {
    const tools = await listTools(base, rpcOptions)
    const names = tools.map(t => t.name)
    for (const intent of INTENT_TOOLS) {
      assert(names.includes(intent), `intent tool \`${intent}\` missing from tools/list`)
    }
    const leakedUi = names.filter(n => UI_TOOL_HINTS.includes(n))
    assert(
      leakedUi.length === 0,
      `UI-only tools leaked to text catalog: ${leakedUi.join(', ')}. Set \`hideToolsByAudience: ['ui']\`.`,
    )
    return { status: 'passed', value: { toolCount: names.length, names } }
  } catch (err) {
    if (err instanceof RpcError && err.info?.httpStatus === 401) {
      const challenge = err.info.wwwAuthenticate ?? ''
      return {
        status: 'failed',
        error:
          'worker gated tools/list; discovery must be anonymous under current @solvapay/mcp (only tools/call requires auth)',
        info: { wwwAuthenticate: challenge || null },
      }
    }
    return {
      status: 'failed',
      error: err.message ?? String(err),
      info: err instanceof RpcError ? err.info : undefined,
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function collectWarnings(checks) {
  const warnings = []
  if (checks.paywallGate?.status === 'skipped') {
    warnings.push(
      `Paid-path check skipped: paywallGate (${checks.paywallGate.reason}). This verifies the MCP/OAuth contract, not a complete paid-tool purchase path.`,
    )
  }
  if (checks.merchantBootstrap?.status === 'skipped') {
    warnings.push(
      `Paid-path check skipped: merchantBootstrap (${checks.merchantBootstrap.reason}). Pass --credentials-file from mcpjam oauth login to exercise the SolvaPay bootstrap path.`,
    )
  }
  return warnings
}

function findToolCandidates(names) {
  return names.filter(n => !INTENT_TOOLS.includes(n) && !UI_TOOL_HINTS.includes(n))
}

/**
 * Try each non-intent / non-UI tool with empty arguments and look for
 * the SolvaPay paywall gate shape: text-only narration in
 * `content[0].text` plus a `structuredContent.gate` payload. Returns
 * `passed` on the first match, `skipped` when no candidate gates (free
 * tools or no tools at all), or `failed` only when a candidate gates
 * but the shape is wrong (text missing, iframe leaked, intent tool not
 * named).
 *
 * Empty-arg invocation deliberately accepts that the upstream may
 * reject the call — we're looking at the SolvaPay envelope, not the
 * upstream response.
 */
async function runPaywallGateCheck(base, candidates, rpcOptions = {}) {
  if (candidates.length === 0) {
    return { status: 'skipped', reason: 'no paid tools registered' }
  }
  for (const name of candidates) {
    let response
    try {
      response = await callTool(base, name, {}, rpcOptions)
    } catch {
      continue
    }
    const gate = response?.structuredContent?.gate
    if (!gate) continue
    try {
      assert(
        Array.isArray(response.content) && response.content[0]?.type === 'text',
        `gate response on \`${name}\` must put narration in content[0].text`,
      )
      const text = response.content[0].text
      assert(
        INTENT_TOOLS.some(intent => text.includes(intent)),
        `gate narration on \`${name}\` must name a recovery intent tool (${INTENT_TOOLS.join(' / ')})`,
      )
      if (gate.reason === 'topup_required') {
        assert(
          text.includes('[Add credits]'),
          `top-up gate on \`${name}\` must label the recovery link [Add credits]`,
        )
        assert(
          typeof gate.links?.topup === 'string' && gate.links.topup.length > 0,
          `top-up gate on \`${name}\` must populate links.topup from paywallReason`,
        )
      }
      if (typeof text === 'string' && text.includes('first link used closes the rest')) {
        assert(
          /links expire in \d+ minutes/.test(text),
          `plan-ladder narration on \`${name}\` must state its own expiry`,
        )
      }
      assert(
        !response._meta?.['ui'],
        `gate response on \`${name}\` must not advertise a UI resource (_meta.ui must be absent on a gate)`,
      )
      return { status: 'passed', value: { tool: name, narrationLength: text.length } }
    } catch (err) {
      return { status: 'failed', error: err.message ?? String(err) }
    }
  }
  return {
    status: 'skipped',
    reason:
      'no candidate tool returned a paywall gate (selections may all be `tier: "free"` or the customer has unused balance)',
  }
}

/**
 * Hit `account` (always-registered intent tool) with
 * `{ mode: 'text' }` and assert the response is not an error envelope
 * carrying SolvaPay bootstrap failure text. The text-mode placeholder
 * goes through `buildBootstrapPayload`, which in turn calls
 * `getMerchantCore` — so a missing merchant on the backend surfaces
 * here as an error result with `Provider` in `content[0].text`. That
 * makes this the single check that exercises the deployed worker's
 * SolvaPay layer end-to-end with real credentials.
 */
async function runMerchantBootstrapCheck(base, rpcOptions) {
  let response
  try {
    response = await callTool(base, 'account', { mode: 'text' }, rpcOptions)
  } catch (err) {
    return {
      status: 'failed',
      error: `account call failed: ${err?.message ?? err}`,
      info: err instanceof RpcError ? err.info : undefined,
    }
  }
  if (!response || typeof response !== 'object') {
    return { status: 'failed', error: 'account returned no response envelope' }
  }
  const text =
    Array.isArray(response.content) && response.content[0]?.type === 'text'
      ? String(response.content[0].text ?? '')
      : ''
  if (response.isError === true) {
    // Both the new `Provider not found` recovery text and any legacy
    // `bootstrap: …` message live under `content[0].text` now (per
    // Phase 0b). Either signal means the deployed worker can't reach
    // its merchant — fail the check with the verbatim text for the
    // human / agent to read.
    return {
      status: 'failed',
      error: 'account returned an error envelope',
      info: { text },
    }
  }
  if (/\bbootstrap\b/i.test(text) && /provider/i.test(text)) {
    return {
      status: 'failed',
      error: 'account narration carries a bootstrap failure',
      info: { text },
    }
  }
  const bootstrap = response.structuredContent
  if (bootstrap && typeof bootstrap === 'object' && 'checkoutPurpose' in bootstrap) {
    const purpose = bootstrap.checkoutPurpose
    if (purpose !== null && purpose !== 'credit_topup') {
      return {
        status: 'failed',
        error: `account checkoutPurpose must be null or credit_topup, got ${JSON.stringify(purpose)}`,
      }
    }
    if (
      (bootstrap.view === 'topup' || bootstrap.view === 'auto-recharge') &&
      purpose !== 'credit_topup'
    ) {
      return {
        status: 'failed',
        error: `view ${bootstrap.view} must mint checkoutPurpose credit_topup`,
      }
    }
  }
  return { status: 'passed', value: { textLength: text.length } }
}

async function runWidgetResourceCheck(base, rpcOptions = {}) {
  return run(async () => {
    const resources = await listResources(base, rpcOptions)
    const widget = resources.find(
      r =>
        typeof r?.uri === 'string' &&
        (r.uri.endsWith('/mcp-app.html') ||
          r.uri.endsWith('mcp-app.html') ||
          r.uri.includes('widget')),
    )
    assert(widget, 'resources/list must include a ui://…/mcp-app.html widget')
    const result = await readResource(base, widget.uri, rpcOptions)
    const content = Array.isArray(result?.contents) ? result.contents[0] : undefined
    assert(content, `resources/read ${widget.uri} returned no contents`)
    const html =
      typeof content.text === 'string'
        ? content.text
        : typeof content.blob === 'string'
          ? content.blob
          : ''
    assert(
      html.includes('<html') || html.includes('<!DOCTYPE'),
      `resources/read ${widget.uri} must return HTML, not a stub`,
    )
    const csp = content._meta?.ui?.csp ?? result?._meta?.ui?.csp
    assert(csp && typeof csp === 'object', `resources/read ${widget.uri} must include _meta.ui.csp`)
    return { uri: widget.uri, htmlLength: html.length }
  })
}

async function runBootstrapResourceCheck(base, rpcOptions = {}) {
  return run(async () => {
    const result = await readResource(base, 'solvapay://bootstrap.json', rpcOptions)
    const content = Array.isArray(result?.contents) ? result.contents[0] : undefined
    assert(content, 'resources/read solvapay://bootstrap.json returned no contents')
    const raw = typeof content.text === 'string' ? content.text : ''
    assert(raw.length > 0, 'bootstrap resource text must be non-empty')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('bootstrap resource is not JSON')
    }
    if ('checkoutPurpose' in parsed) {
      assert(
        parsed.checkoutPurpose === null || parsed.checkoutPurpose === 'credit_topup',
        `bootstrap checkoutPurpose must be null or credit_topup, got ${JSON.stringify(parsed.checkoutPurpose)}`,
      )
    }
    return {
      hasCheckoutUrl: typeof parsed.checkoutUrl === 'string',
      hasPortalUrl: typeof parsed.portalUrl === 'string',
      checkoutPurpose: parsed.checkoutPurpose ?? null,
      view: parsed.view ?? null,
    }
  })
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
