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
 *   - `tools/list` returns the four intent tools (`upgrade`, `topup`,
 *     `activate_plan`, `manage_account`) plus the generated tools, with
 *     UI-only tools hidden.
 *   - When at least one paid tool is registered: call it past the
 *     paywall and assert text-only narration in `content[0].text` (no
 *     iframe, no structured UI payload on the gate).
 *
 * Output: JSON pass/fail/skipped map on stdout. Exit code 0 if no
 * check failed (skipped + passed are fine), 1 otherwise.
 */

import { readFileSync } from 'node:fs'
import { rpc, listTools, callTool, getJson, RpcError } from './lib/mcp-client.mjs'

const INTENT_TOOLS = ['upgrade', 'topup', 'activate_plan', 'manage_account']
const UI_TOOL_HINTS = ['create_payment_intent', 'create_topup_payment_intent', 'create_checkout_session']

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workerUrl) {
    console.error('Usage: verify.mjs <worker-url> [--credentials-file <path>]')
    process.exit(2)
  }

  // `--credentials-file` accepts the JSON file written by
  // `mcpjam oauth login --credentials-out`. When present, the new
  // `merchantBootstrap` check actually exercises the SolvaPay layer
  // by calling `manage_account` with a bearer token. Without it, the
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
    assert(typeof meta.authorization_endpoint === 'string', 'authorization_endpoint must be a string')
    assert(typeof meta.token_endpoint === 'string', 'token_endpoint must be a string')
    return { issuer: meta.issuer }
  })

  const toolsResult = await runToolsListCheck(base, rpcOptions)
  checks.toolsList = toolsResult

  // `paywallGate` needs the catalog to pick a candidate tool. When the
  // worker is gated (`requireAuth: true` default) and no credentials
  // were supplied, the gate check has to be skipped — that's a known
  // limitation of an anonymous probe, not a worker bug. With
  // `--credentials-file`, the catalog is available so the gate check
  // runs against authenticated tool calls.
  const candidates =
    toolsResult.status === 'passed' && Array.isArray(toolsResult.value.names)
      ? findToolCandidates(toolsResult.value.names)
      : []
  checks.paywallGate =
    toolsResult.status === 'passed' && toolsResult.value.authRequired && !bearerToken
      ? {
          status: 'skipped',
          reason:
            'worker requires bearer auth; pass `--credentials-file <path>` from `mcpjam oauth login --credentials-out` to exercise the paywall gate',
        }
      : await runPaywallGateCheck(base, candidates, rpcOptions)

  // `merchantBootstrap` exercises the SolvaPay bootstrap path by
  // calling `manage_account` (an intent tool, always registered) and
  // asserting the response is not an error envelope. Without a bearer
  // token, the call would gate at the HTTP layer — so it skips. With
  // a bearer token, a 500 or text containing `"bootstrap"` is a real
  // failure (typically `Provider not found` post-deploy).
  checks.merchantBootstrap = bearerToken
    ? await runMerchantBootstrapCheck(base, rpcOptions)
    : { status: 'skipped', reason: 'no --credentials-file passed; cannot exercise SolvaPay bootstrap' }

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
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--credentials-file') {
      credentialsFile = argv[++i]
    } else if (!workerUrl) {
      workerUrl = arg
    }
  }
  return { workerUrl, credentialsFile }
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
 * Two valid contract shapes for `tools/list`:
 *
 * 1. Anonymous list succeeds → assert intent tools present + no UI leak.
 * 2. Anonymous list returns `401` with a well-formed
 *    `WWW-Authenticate: Bearer resource_metadata="…"` challenge →
 *    server is correctly gated, treat as passed and surface
 *    `authRequired: true` so the downstream paywall check knows to
 *    skip itself.
 *
 * A 401 without a challenge, or any other error, is a real failure.
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
    return { status: 'passed', value: { toolCount: names.length, names, authRequired: false } }
  } catch (err) {
    if (err instanceof RpcError && err.info?.httpStatus === 401) {
      const challenge = err.info.wwwAuthenticate ?? ''
      if (/^Bearer\b/i.test(challenge) && /resource_metadata="/.test(challenge)) {
        return {
          status: 'passed',
          value: { authRequired: true, wwwAuthenticate: challenge },
        }
      }
      return {
        status: 'failed',
        error: 'worker returned 401 without a well-formed `WWW-Authenticate: Bearer …` challenge',
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
    reason: 'no candidate tool returned a paywall gate (selections may all be `tier: "free"` or the customer has unused balance)',
  }
}

/**
 * Hit `manage_account` (always-registered intent tool) with
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
    response = await callTool(base, 'manage_account', { mode: 'text' }, rpcOptions)
  } catch (err) {
    return {
      status: 'failed',
      error: `manage_account call failed: ${err?.message ?? err}`,
      info: err instanceof RpcError ? err.info : undefined,
    }
  }
  if (!response || typeof response !== 'object') {
    return { status: 'failed', error: 'manage_account returned no response envelope' }
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
      error: 'manage_account returned an error envelope',
      info: { text },
    }
  }
  if (/\bbootstrap\b/i.test(text) && /provider/i.test(text)) {
    return {
      status: 'failed',
      error: 'manage_account narration carries a bootstrap failure',
      info: { text },
    }
  }
  return { status: 'passed', value: { textLength: text.length } }
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
