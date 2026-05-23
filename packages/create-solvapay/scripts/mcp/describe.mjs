#!/usr/bin/env node
/* global console, process, fetch, AbortController, setTimeout, clearTimeout */
/**
 * `describe.mjs <spec> [--no-probe]` — read-only OpenAPI inspector.
 *
 * Dereferences the spec and prints a JSON summary on stdout:
 *   - openapiVersion / title / servers
 *   - securitySchemes (with `supported: true|false`)
 *   - operations (operationId, method, path, suggestedTier, parameters,
 *     synthesized examples, examplesQuality flag)
 *   - serverProbe (live HTTP check against `servers[0]` — see below)
 *   - advisories (one per operation requiring an unsupported scheme,
 *     plus one for a probe mismatch)
 *
 * The server probe catches the most common scaffolding trap: the
 * OpenAPI spec declares `/pets` but the URL in `servers[0]` actually
 * hosts a different shape (e.g. `petstore.swagger.io/v2` uses
 * singular `/pet`, not `/pets`). Without the probe, the mismatch only
 * surfaces at first tool call as an upstream 404 / XML / HTML — too
 * late and too cryptic. Pass `--no-probe` to skip when working with
 * a private upstream that isn't reachable from this machine.
 *
 * No file writes. Safe to run repeatedly while iterating on which
 * operations to expose. The agent reads this output to populate
 * `selections.json`.
 *
 * Usage:
 *   node scripts/describe.mjs path/to/openapi.json
 *   node scripts/describe.mjs path/to/openapi.json --no-probe
 */

import {
  loadSpec,
  listOperations,
  resolveSecuritySchemes,
  suggestTier,
  synthesizeExamples,
  buildAdvisories,
  getServerUrls,
} from './lib/openapi.mjs'

const PROBE_TIMEOUT_MS = 5000
const PROBE_BODY_SNIPPET_MAX = 200

async function main() {
  const { specPath, probe } = parseArgs(process.argv.slice(2))
  if (!specPath) {
    console.error('Usage: describe.mjs <spec> [--no-probe]')
    process.exit(2)
  }

  const { spec } = await loadSpec(specPath)
  const operations = listOperations(spec)
  const schemes = resolveSecuritySchemes(spec)
  const servers = getServerUrls(spec)

  const serverProbe = probe ? await runServerProbe(servers[0], operations) : { status: 'skipped', reason: '--no-probe' }
  const advisories = [...buildAdvisories(operations, schemes), ...buildProbeAdvisories(serverProbe)]

  const summary = {
    openapiVersion: spec.openapi ?? spec.swagger ?? null,
    title: spec.info?.title ?? null,
    description: spec.info?.description ?? null,
    servers,
    securitySchemes: schemes,
    operations: operations.map(op => {
      const { inputs, examplesQuality } = synthesizeExamples(op)
      return {
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        summary: op.summary,
        deprecated: op.deprecated,
        tags: op.tags,
        suggestedTier: suggestTier(op),
        parameters: op.parameters.map(p => ({
          name: p.name,
          in: p.in,
          type: p.type,
          required: p.required,
        })),
        requestBody: op.requestBody
          ? { required: op.requestBody.required, contentType: 'application/json' }
          : null,
        examples: inputs,
        examplesQuality,
      }
    }),
    serverProbe,
    advisories,
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

function parseArgs(argv) {
  let specPath
  let probe = true
  for (const arg of argv) {
    if (arg === '--no-probe') probe = false
    else if (!specPath) specPath = arg
  }
  return { specPath, probe }
}

/**
 * Live HTTP probe against `servers[0]`. Two checks:
 *
 *  1. HEAD `<server>` — confirms the host resolves and responds. Cheap.
 *  2. GET `<server><firstReadablePath>` with `Accept: application/json`
 *     — sample-call to verify the server actually hosts the operations
 *     the spec promises. Records status, content-type, and whether the
 *     body parses as JSON. A 4xx + non-JSON body here means the spec's
 *     paths don't match what the server serves (the canonical
 *     "petstore.yaml vs petstore.swagger.io/v2" trap).
 *
 * Both checks are best-effort: timeouts, DNS failures, and TLS errors
 * land as `status: 'error'` with the error message in `reason`, not as
 * a thrown exception.
 */
async function runServerProbe(serverUrl, operations) {
  if (!serverUrl) {
    return { status: 'skipped', reason: 'spec declares no servers (or host/basePath for Swagger 2.0)' }
  }

  const head = await probeHead(serverUrl)
  const sampleGet = await probeSampleGet(serverUrl, operations)

  return {
    status: deriveProbeStatus(head, sampleGet),
    serverUrl,
    head,
    sampleGet,
  }
}

function deriveProbeStatus(head, sampleGet) {
  if (head?.error || sampleGet?.error) return 'error'
  if (sampleGet?.status === 'skipped') return head?.ok ? 'partial' : 'error'
  if (sampleGet?.ok && sampleGet?.parsedAsJson) return 'ok'
  return 'mismatch'
}

async function probeHead(serverUrl) {
  try {
    const res = await fetchWithTimeout(serverUrl, { method: 'HEAD' })
    return {
      ok: res.status < 400,
      status: res.status,
      contentType: res.headers.get('content-type') ?? null,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function probeSampleGet(serverUrl, operations) {
  const candidate = pickProbeOperation(operations)
  if (!candidate) {
    return { status: 'skipped', reason: 'no GET operation suitable for probing' }
  }
  const { op, inputs } = candidate
  const path = substitutePathParams(op.path, op.parameters, inputs)
  const url = joinUrl(serverUrl, path)
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    const contentType = res.headers.get('content-type') ?? ''
    const text = await res.text()
    let parsedAsJson = false
    if (text.length > 0) {
      try {
        JSON.parse(text)
        parsedAsJson = true
      } catch {
        parsedAsJson = false
      }
    }
    return {
      ok: res.status < 400,
      status: res.status,
      contentType,
      parsedAsJson,
      bodySnippet: text.slice(0, PROBE_BODY_SNIPPET_MAX),
      probedUrl: url,
      operationId: op.operationId,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), probedUrl: url, operationId: op.operationId }
  }
}

function pickProbeOperation(operations) {
  // Prefer GET operations whose path params have real example values
  // (so the probe URL is a meaningful request, not a placeholder
  // `/pet/0`). Fall back to a GET with no path params at all.
  const gets = operations.filter(op => op.method === 'GET' && !op.deprecated)
  for (const op of gets) {
    const { inputs, examplesQuality } = synthesizeExamples(op)
    if (examplesQuality === 'real') return { op, inputs }
  }
  for (const op of gets) {
    const hasPathParam = op.parameters.some(p => p.in === 'path')
    if (!hasPathParam) return { op, inputs: {} }
  }
  return null
}

function substitutePathParams(path, parameters, inputs) {
  let out = path
  for (const param of parameters) {
    if (param.in !== 'path') continue
    const value = inputs[param.name]
    if (value === undefined) continue
    out = out.replace(`{${param.name}}`, String(value))
  }
  return out
}

function joinUrl(base, path) {
  const trimmed = base.replace(/\/$/, '')
  const prefix = path.startsWith('/') ? path : `/${path}`
  return `${trimmed}${prefix}`
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function buildProbeAdvisories(probe) {
  if (!probe || probe.status === 'ok' || probe.status === 'skipped') return []
  if (probe.status === 'mismatch') {
    const sample = probe.sampleGet ?? {}
    return [
      {
        kind: 'serverProbeMismatch',
        message:
          `Spec's \`servers[0]\` (${probe.serverUrl}) responded ${sample.status} ${sample.contentType || '(no content-type)'} for ` +
          `${sample.probedUrl} — the URL may not host the operations declared in this spec. ` +
          `Verify with \`curl -i -H "Accept: application/json" ${sample.probedUrl}\` before scaffolding. ` +
          `Common cause: the OpenAPI document is a generic example (e.g. learn.openapis.org petstore) whose ` +
          `\`servers\` URL doesn't actually serve those paths.`,
      },
    ]
  }
  if (probe.status === 'error') {
    return [
      {
        kind: 'serverProbeError',
        message:
          `Could not reach spec's \`servers[0]\` (${probe.serverUrl}): ` +
          `${probe.head?.error ?? probe.sampleGet?.error ?? 'unknown error'}. ` +
          `Either the upstream is not publicly reachable from this machine, or the URL is wrong. ` +
          `Re-run with \`--no-probe\` to skip if this is expected.`,
      },
    ]
  }
  return []
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
