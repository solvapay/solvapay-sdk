#!/usr/bin/env node
/* global console, process */
/**
 * `test.mjs <worker-url> --spec <openapi-path>` — smoke harness that
 * exercises each generated tool with sample inputs derived from the
 * OpenAPI examples.
 *
 * Sample-input synthesis comes from `lib/openapi.mjs` (same source as
 * `describe.mjs` so the agent sees the inputs `test` will use before
 * `scaffold` runs). Operations flagged `examplesQuality: "placeholder"`
 * are reported as `skipped` rather than `failed` — placeholder values
 * are for shape testing, not for hitting a real upstream.
 *
 * Output: JSON pass/fail/skipped map. Exit code 0 unless a real
 * (non-skipped) tool failed.
 *
 * Usage (from the scaffolded project root, after `( cd scripts && npm install )`):
 *   node scripts/test.mjs https://my-worker.example.com \
 *     --spec path/to/openapi.json
 */

import { readFileSync } from 'node:fs'
import {
  loadSpec,
  listOperations,
  suggestTier,
  synthesizeExamples,
} from './lib/openapi.mjs'
import { listTools, callTool, RpcError } from './lib/mcp-client.mjs'

const INTENT_TOOLS = new Set(['upgrade', 'topup', 'activate_plan', 'manage_account'])

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workerUrl || !args.specPath) {
    console.error('Usage: test.mjs <worker-url> --spec <openapi-path> [--credentials-file <path>]')
    process.exit(2)
  }
  const base = args.workerUrl.replace(/\/$/, '')

  // `--credentials-file` accepts an MCPJam `oauth login --credentials-out`
  // dump and pulls `accessToken` off it. The file's other fields
  // (`refreshToken`, `expiresAt`, ...) are ignored — refresh-only flows
  // are documented as a separate cycle here. If the file exists but
  // has no `accessToken`, exit 2 with a hint so the human knows to
  // re-run `mcpjam oauth login`.
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

  const { spec } = await loadSpec(args.specPath)
  const operations = listOperations(spec)

  // Anonymous `tools/list` is gated when the worker uses the SDK default
  // `requireAuth: true`. The well-formed challenge response is the same
  // signal `verify.mjs` treats as a pass — here we surface it as a
  // structured `overall: "skipped"` so the human sees a one-line reason
  // instead of a stack trace and knows to either pass a bearer token
  // via `--credentials-file` or temporarily flip the worker to
  // `requireAuth: false`.
  let exposedTools
  try {
    exposedTools = new Set((await listTools(base, rpcOptions)).map(t => t.name))
  } catch (err) {
    if (err instanceof RpcError && err.info?.httpStatus === 401) {
      const challenge = err.info.wwwAuthenticate ?? ''
      if (/^Bearer\b/i.test(challenge) && /resource_metadata="/.test(challenge)) {
        const summary = {
          workerUrl: base,
          specPath: args.specPath,
          results: [],
          overall: 'skipped',
          reason: bearerToken
            ? 'worker rejected bearer token; credentials may be expired — re-run `mcpjam oauth login`'
            : 'worker requires bearer auth; pass `--credentials-file <path>` from `mcpjam oauth login --credentials-out`',
          wwwAuthenticate: challenge,
        }
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
        process.exit(0)
      }
    }
    throw err
  }

  const operationIds = new Set(operations.map(op => op.operationId))
  const results = []
  for (const op of operations) {
    const tier = suggestTier(op)
    if (tier === 'skip') {
      results.push({ operationId: op.operationId, status: 'skipped', reason: 'tier is `skip` in spec heuristic' })
      continue
    }
    if (!exposedTools.has(op.operationId)) {
      results.push({
        operationId: op.operationId,
        status: 'skipped',
        reason: 'operation not registered as a tool on the worker (probably tier: "skip" in selections.json, or intent-driven mode)',
      })
      continue
    }
    const { inputs, examplesQuality } = synthesizeExamples(op)
    if (examplesQuality === 'placeholder') {
      results.push({
        operationId: op.operationId,
        status: 'skipped',
        reason: 'no real example data in spec',
        inputs,
      })
      continue
    }
    try {
      const response = await callTool(base, op.operationId, inputs, rpcOptions)
      if (response?.isError) {
        results.push({
          operationId: op.operationId,
          status: 'failed',
          reason: 'tool returned isError=true',
          response: summariseResponse(response),
        })
      } else {
        results.push({
          operationId: op.operationId,
          status: 'passed',
          tier,
          response: summariseResponse(response),
        })
      }
    } catch (err) {
      results.push({
        operationId: op.operationId,
        status: 'failed',
        reason: err.message ?? String(err),
        info: err instanceof RpcError ? err.info : undefined,
      })
    }
  }

  // Intent-driven detection: any tool exposed by the worker that
  // doesn't match an OpenAPI `operationId` and isn't a built-in
  // SolvaPay intent tool is reported `skipped` with a pointer to the
  // intent-driven manual smoke-test path. Detection works because
  // `operationId` is unique within an OpenAPI spec by spec rules, so
  // a worker tool that's neither in the spec nor in the intent set is
  // almost certainly an agent-authored intent tool.
  for (const toolName of exposedTools) {
    if (operationIds.has(toolName)) continue
    if (INTENT_TOOLS.has(toolName)) continue
    results.push({
      toolName,
      status: 'skipped',
      reason: 'intent tool — author test inputs manually (see intent-driven.md)',
    })
  }

  const paywallGate = await runPaywallGateProbe(base, exposedTools, rpcOptions)

  const summary = {
    workerUrl: base,
    specPath: args.specPath,
    results,
    paywallGate,
    overall: results.every(r => r.status !== 'failed') && paywallGate.status !== 'failed' ? 'passed' : 'failed',
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(summary.overall === 'passed' ? 0 : 1)
}

function parseArgs(argv) {
  let workerUrl
  let specPath
  let credentialsFile
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--spec') {
      specPath = argv[++i]
    } else if (arg === '--credentials-file') {
      credentialsFile = argv[++i]
    } else if (!workerUrl) {
      workerUrl = arg
    }
  }
  return { workerUrl, specPath, credentialsFile }
}

/**
 * Optional smoke check that calls one candidate tool past the
 * customer's plan limit and asserts the response is a text-only gate.
 * `skipped` when no candidate exists, when the customer has unused
 * balance (the call succeeds), or when the worker's auth surface
 * refuses anonymous calls (401).
 */
async function runPaywallGateProbe(base, exposedTools, rpcOptions = {}) {
  const candidates = Array.from(exposedTools).filter(name => !INTENT_TOOLS.has(name))
  if (candidates.length === 0) {
    return { status: 'skipped', reason: 'no candidate tools exposed' }
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
    const text = response.content?.[0]?.text
    if (typeof text !== 'string' || !Array.from(INTENT_TOOLS).some(intent => text.includes(intent))) {
      return {
        status: 'failed',
        reason: `gate response on \`${name}\` is missing or malformed text narration`,
      }
    }
    return { status: 'passed', tool: name }
  }
  return {
    status: 'skipped',
    reason: 'no candidate gated (customer may still have balance, or no paid tools registered)',
  }
}

function summariseResponse(response) {
  const text = response?.content?.[0]?.text
  // Failed tools — including upstream-error envelopes produced by
  // `upstreamFetchJson`'s thrown `UpstreamError` — need the full
  // multi-line error message, not the 160-char preview we use for
  // happy-path responses. The error text carries the upstream HTTP
  // status, content-type, and body snippet; truncating it hides the
  // exact field the human needs to debug the failure.
  const isError = response?.isError === true
  const previewLimit = isError ? 1000 : 160
  return {
    hasStructuredContent: response?.structuredContent !== undefined,
    isError,
    textPreview: typeof text === 'string' ? text.slice(0, previewLimit) : null,
  }
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
