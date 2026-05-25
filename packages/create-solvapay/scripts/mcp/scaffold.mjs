#!/usr/bin/env node
/* global console, process */
/**
 * `scaffold.mjs <spec> <target-dir> --selections <path>` — generate a
 * SolvaPay-wired Cloudflare Workers MCP server from an OpenAPI spec.
 *
 * Destructive: refuses to overwrite an existing `target-dir`. Reads
 * `selections.json` from a path *outside* `target-dir` (the agent
 * writes it to `/tmp/selections-<uuid>.json` and deletes after; see
 * `scaffold.md`). The file contains the upstream API key, so it must
 * never land inside the project a follow-up `git add .` would catch.
 *
 * Output (on stdout, JSON):
 *   {
 *     filesWritten: string[],
 *     operationsGenerated: { operationId, tier }[],
 *     secretsSeeded: { name, location }[],
 *     publicBaseUrlPlaceholder: string,
 *     reminders: string[]
 *   }
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadSpec,
  listOperations,
  resolveSecuritySchemes,
  getServerUrls,
} from './lib/openapi.mjs'
import {
  PLACEHOLDERS,
  applyOverlayDir,
  assertTargetDirAbsent,
  copyDir,
} from './lib/template.mjs'

// `fileURLToPath` is the Windows-safe way to convert `import.meta.url`
// to a filesystem path — the previous `new URL(import.meta.url).pathname`
// approach returned `/C:/...` on Windows and broke once published to npm.
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_TEMPLATE_DIR = resolve(HERE, '..', '..', 'templates', 'mcp', '_base')
const OPENAPI_OVERLAY_DIR = resolve(HERE, '..', '..', 'templates', 'mcp', 'from-openapi')

const VALID_AUTH_KINDS = new Set(['none', 'bearer', 'apiKey', 'oauth2-client-credentials'])
const VALID_TIERS = new Set(['free', 'paid', 'skip'])
const VALID_MODES = new Set(['one-to-one', 'intent-driven'])

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { specPath, targetDir, selectionsPath } = args

  const target = resolve(targetDir)
  const selectionsAbs = resolve(selectionsPath)
  assertSelectionsOutsideTarget(selectionsAbs, target)
  await assertTargetDirAbsent(target)
  await assertTemplatePresent(BASE_TEMPLATE_DIR)

  const selections = await readSelections(selectionsAbs)
  const mode = selections.mode ?? 'one-to-one'
  const { spec } = await loadSpec(specPath)
  const operations = listOperations(spec)
  const schemes = resolveSecuritySchemes(spec)

  // Selection matching + auth enforcement run on per-op selections;
  // intent mode has none, so skip both. Per-op auth conflicts that
  // intent tools might hit show up when the agent authors the tool —
  // not at scaffold time.
  const selectedOps =
    mode === 'intent-driven'
      ? []
      : matchSelectionsToOperations(selections.operations, operations)
  if (mode !== 'intent-driven') {
    enforceAuthSupport(selectedOps, schemes, selections.upstreamAuth)
  }

  const serverName =
    typeof selections.serverName === 'string' && selections.serverName.length > 0
      ? selections.serverName
      : deriveServerNameFromWorkerName(selections.workerName)
  const substitutions = new Map([
    [PLACEHOLDERS.WORKER_NAME, selections.workerName],
    [PLACEHOLDERS.RESOURCE_URI_SLUG, selections.workerName],
    [PLACEHOLDERS.SERVER_NAME, serverName],
    [PLACEHOLDERS.PUBLIC_BASE_URL, selections.mcpPublicBaseUrl],
  ])
  if (typeof selections.solvapayProductRef === 'string') {
    substitutions.set(PLACEHOLDERS.PRODUCT_REF, selections.solvapayProductRef)
  }

  await copyDir(BASE_TEMPLATE_DIR, target, {
    substitutions,
  })
  await applyOpenApiOverlay(target, substitutions)

  const generated = []
  const toolFiles = []
  for (const { selection, operation } of selectedOps) {
    if (selection.tier === 'skip') continue
    const filename = `${operation.operationId}.ts`
    const filePath = join(target, 'src', 'tools', filename)
    const toolSource = renderToolFile({
      operation,
      schemes,
      tier: selection.tier,
      auth: selections.upstreamAuth,
      serverBaseUrl: pickServerUrl(spec),
    })
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, toolSource, 'utf8')
    generated.push({ operationId: operation.operationId, tier: selection.tier })
    toolFiles.push(operation.operationId)
  }

  await writeIndexFile(target, toolFiles, selections.upstreamAuth.kind, mode)
  await ensureGitignoreCoversEnv(target)
  const envWritten = await writeDotEnv(target, selections)

  const reminders =
    mode === 'intent-driven'
      ? [
          'Intent-driven mode: author src/tools/*.ts files per intent-driven.md, then update src/tools/index.ts to import and call each register{IntentName}(ctx, env). The .env and project skeleton are ready.',
          `Run \`npx solvapay init\` inside ${target} to populate SOLVAPAY_SECRET_KEY (see solvapay-init.md).`,
          `\`node scripts/verify.mjs <url>\` runs from ${target} with no extra setup. \`node scripts/test.mjs\` will report intent tools as skipped (they aren't in the spec's operationIds) — exercise them manually per intent-driven.md.`,
        ]
      : [
          `Run \`npx solvapay init\` inside ${target} to populate SOLVAPAY_SECRET_KEY (see solvapay-init.md).`,
          `\`node scripts/verify.mjs <url>\` runs from ${target} with no extra setup. Before \`node scripts/test.mjs\`, run \`( cd scripts && npm install )\` once inside ${target} (see test.md).`,
        ]

  const summary = {
    mode,
    filesWritten: collectWrittenPaths(target, toolFiles, envWritten),
    operationsGenerated: generated,
    secretsSeeded: secretsSeededFor(selections.upstreamAuth),
    publicBaseUrlPlaceholder: selections.mcpPublicBaseUrl,
    reminders,
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

function parseArgs(argv) {
  let specPath
  let targetDir
  let selectionsPath
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selections') {
      selectionsPath = argv[++i]
    } else if (!specPath) {
      specPath = arg
    } else if (!targetDir) {
      targetDir = arg
    }
  }
  if (!specPath || !targetDir || !selectionsPath) {
    console.error('Usage: scaffold.mjs <spec> <target-dir> --selections <path>')
    process.exit(2)
  }
  if (!isAbsolute(selectionsPath) && !selectionsPath.startsWith('.')) {
    // Accept either; resolve happens later. This is a soft hint, not a fail.
  }
  return { specPath, targetDir, selectionsPath }
}

function assertSelectionsOutsideTarget(selectionsAbs, targetAbs) {
  const rel = relative(targetAbs, selectionsAbs)
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    throw new Error(
      `selections.json at ${selectionsAbs} is inside the target directory. ` +
        `Move it to a non-project path (e.g. /tmp/selections-<uuid>.json) so it can't leak via \`git add .\`.`,
    )
  }
}

async function assertTemplatePresent(templateDir) {
  try {
    await access(templateDir)
  } catch {
    throw new Error(
      `Template directory missing: ${templateDir}. ` +
        `The packaged templates/mcp/_base/ tree did not ship with this build.`,
    )
  }
  // `src/worker.ts` is the entrypoint scaffold expects to copy and the
  // file `src/tools/index.ts` imports `Env` from. If it's missing the
  // template is still in placeholder state, and scaffold would silently
  // produce a near-empty project.
  const marker = join(templateDir, 'src', 'worker.ts')
  try {
    await access(marker)
  } catch {
    throw new Error(
      `Template marker file missing: ${marker}. ` +
        `templates/mcp/_base/ is in placeholder state — investigate the published create-solvapay tarball.`,
    )
  }
}

/**
 * Apply the `from-openapi` overlay against an already-copied `_base` tree.
 *
 * Overlay rules:
 *   - `<file>.append`        → append to `<file>` (e.g. `.env.example.append`
 *                              becomes a suffix on `.env.example`).
 *   - `<file>.append.md`     → append to `<file>.md` (e.g. README.append.md
 *                              → README.md).
 *   - everything else        → straight overwrite.
 *
 * Placeholder substitution runs against text overlay payloads via the
 * same `substitute` helper used by `copyDir`, so `__SOLVAPAY_PRODUCT_REF__`
 * and friends are resolved before append.
 */
async function applyOpenApiOverlay(target, substitutions) {
  await applyOverlayDir(OPENAPI_OVERLAY_DIR, target, substitutions)
}

async function readSelections(selectionsPath) {
  const raw = await readFile(selectionsPath, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Could not parse ${selectionsPath} as JSON: ${err.message}`)
  }
  validateSelections(parsed)
  return parsed
}

function validateSelections(selections) {
  if (!selections || typeof selections !== 'object') {
    throw new Error('selections.json: expected an object at the root.')
  }
  requireString(selections, 'workerName')
  requireString(selections, 'mcpPublicBaseUrl')
  if (
    selections.solvapayProductRef !== undefined &&
    typeof selections.solvapayProductRef !== 'string'
  ) {
    throw new Error('selections.json: `solvapayProductRef` must be a string when provided.')
  }
  if (selections.mode !== undefined && !VALID_MODES.has(selections.mode)) {
    throw new Error(
      `selections.json: \`mode\` must be one of ${[...VALID_MODES].join(', ')} when provided.`,
    )
  }
  if (!selections.upstreamAuth || typeof selections.upstreamAuth !== 'object') {
    throw new Error('selections.json: `upstreamAuth` is required.')
  }
  const auth = selections.upstreamAuth
  if (!VALID_AUTH_KINDS.has(auth.kind)) {
    throw new Error(
      `selections.json: \`upstreamAuth.kind\` must be one of ${[...VALID_AUTH_KINDS].join(', ')}.`,
    )
  }
  if (auth.kind === 'bearer' && typeof auth.key !== 'string') {
    throw new Error('selections.json: `upstreamAuth.key` is required when `kind` is "bearer".')
  }
  if (auth.kind === 'apiKey') {
    if (auth.in !== 'header') {
      throw new Error(
        'selections.json: only `upstreamAuth.in: "header"` is supported in v1. ' +
          'For query/cookie apiKey, set `upstreamAuth.kind: "none"` and skip affected operations.',
      )
    }
    if (typeof auth.name !== 'string' || typeof auth.key !== 'string') {
      throw new Error(
        'selections.json: `upstreamAuth.name` and `upstreamAuth.key` are required when `kind` is "apiKey".',
      )
    }
  }
  if (auth.kind === 'oauth2-client-credentials') {
    validateOauth2ClientCredentialsSelection(auth)
  }
  // Intent-driven mode owns its own `src/tools/*.ts` files, so no
  // per-op selections are needed. One-to-one mode (default) still
  // requires the operations array — the per-op codegen reads from it.
  const mode = selections.mode ?? 'one-to-one'
  if (mode === 'intent-driven') {
    if (selections.operations !== undefined && !Array.isArray(selections.operations)) {
      throw new Error(
        'selections.json: when `mode` is "intent-driven", `operations` must be omitted or an array (it is ignored).',
      )
    }
    return
  }
  if (!Array.isArray(selections.operations)) {
    throw new Error('selections.json: `operations` must be an array.')
  }
  for (const entry of selections.operations) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('selections.json: each entry in `operations` must be an object.')
    }
    if (typeof entry.operationId !== 'string') {
      throw new Error('selections.json: each entry needs `operationId`.')
    }
    if (!VALID_TIERS.has(entry.tier)) {
      throw new Error(
        `selections.json: operation ${entry.operationId} has invalid tier \`${entry.tier}\`. ` +
          `Expected one of: ${[...VALID_TIERS].join(', ')}.`,
      )
    }
  }
}

function requireString(obj, key) {
  if (typeof obj[key] !== 'string' || obj[key].length === 0) {
    throw new Error(`selections.json: \`${key}\` is required and must be a non-empty string.`)
  }
}

function validateOauth2ClientCredentialsSelection(auth) {
  if (typeof auth.tokenUrl !== 'string' || auth.tokenUrl.length === 0) {
    throw new Error(
      'selections.json: `upstreamAuth.tokenUrl` is required when `kind` is "oauth2-client-credentials".',
    )
  }
  let parsed
  try {
    parsed = new URL(auth.tokenUrl)
  } catch {
    throw new Error(
      `selections.json: \`upstreamAuth.tokenUrl\` must be a valid URL (got \`${auth.tokenUrl}\`).`,
    )
  }
  // Allow `http://localhost` (and 127.0.0.1) so unit tests can exercise
  // the flow against a mock token server without HTTPS. Anything else
  // must be HTTPS — leaking client credentials over plain HTTP would
  // defeat the whole point of using OAuth.
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    throw new Error(
      `selections.json: \`upstreamAuth.tokenUrl\` must use https:// (got \`${auth.tokenUrl}\`). ` +
        'Only `http://localhost` and `http://127.0.0.1` are permitted for local tests.',
    )
  }
  if (typeof auth.clientId !== 'string' || auth.clientId.length === 0) {
    throw new Error(
      'selections.json: `upstreamAuth.clientId` is required when `kind` is "oauth2-client-credentials".',
    )
  }
  if (typeof auth.clientSecret !== 'string' || auth.clientSecret.length === 0) {
    throw new Error(
      'selections.json: `upstreamAuth.clientSecret` is required when `kind` is "oauth2-client-credentials".',
    )
  }
  if (auth.scope !== undefined && typeof auth.scope !== 'string') {
    throw new Error('selections.json: `upstreamAuth.scope` must be a string when provided.')
  }
  if (auth.audience !== undefined && typeof auth.audience !== 'string') {
    throw new Error('selections.json: `upstreamAuth.audience` must be a string when provided.')
  }
}

function matchSelectionsToOperations(selectionEntries, allOps) {
  const byId = new Map(allOps.map(op => [op.operationId, op]))
  const matched = []
  for (const sel of selectionEntries) {
    const op = byId.get(sel.operationId)
    if (!op) {
      throw new Error(
        `selections.json references unknown operationId \`${sel.operationId}\`. ` +
          `Run describe.mjs against the same spec to see the available operations.`,
      )
    }
    matched.push({ selection: sel, operation: op })
  }
  return matched
}

function enforceAuthSupport(matched, schemes, upstreamAuth) {
  if (upstreamAuth.kind === 'none') return
  const unsupportedByName = new Map(
    schemes.filter(s => !s.supported).map(s => [s.name, s]),
  )
  if (unsupportedByName.size === 0) return
  for (const { selection, operation } of matched) {
    if (selection.tier === 'skip') continue
    const requirements = operation.security ?? []
    for (const req of requirements) {
      for (const name of Object.keys(req)) {
        if (unsupportedByName.has(name)) {
          throw new Error(
            `Operation \`${operation.operationId}\` requires unsupported security scheme ` +
              `\`${name}\` (${unsupportedByName.get(name).reason}). ` +
              `Either mark it \`tier: "skip"\` in selections.json, or set ` +
              `\`upstreamAuth.kind: "none"\` if the upstream tolerates anonymous calls.`,
          )
        }
      }
    }
  }
}

function pickServerUrl(spec) {
  const urls = getServerUrls(spec)
  return urls[0] ?? 'https://upstream.example.com'
}

/**
 * Fallback used when callers invoke scaffold.mjs directly without
 * passing `serverName` in selections (kept for back-compat with the
 * agent path that authors selections.json by hand). Mirrors the
 * package-side `deriveServerName` so the placeholder substitution
 * stays consistent across the two scaffold paths.
 */
function deriveServerNameFromWorkerName(workerName) {
  const cleaned = String(workerName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'solvapay-mcp-server'
}

function renderToolFile({ operation, schemes, tier, auth, serverBaseUrl }) {
  const fnName = `register${capitalize(operation.operationId)}`
  const urlTemplate = renderUrlTemplate(serverBaseUrl, operation)
  const headerLines = renderHeaderLines(auth, schemes, operation)
  const includesEnv = headerLines.length > 0
  const needsAccessToken = auth.kind === 'oauth2-client-credentials'
  const signature = includesEnv
    ? `${fnName}(ctx: AdditionalToolsContext, env: Env)`
    : `${fnName}(ctx: AdditionalToolsContext)`
  const fetchInit = renderFetchInit(operation, headerLines)
  const body = tier === 'paid'
    ? renderPayableBody({ operation, urlTemplate, fetchInit, needsAccessToken })
    : renderFreeBody({ operation, urlTemplate, fetchInit, needsAccessToken })

  // `upstreamFetchJson` is the template-shipped helper at
  // `src/lib/upstreamFetch.ts`. It sends `Accept: application/json`,
  // throws `UpstreamError` on non-2xx or non-JSON responses, and
  // carries `{ status, contentType, bodySnippet }` on the thrown
  // error so the MCP `isError` envelope tells the LLM (and the
  // human) exactly why upstream rejected the call.
  const importLines = [
    "import { z } from 'zod'",
    "import type { AdditionalToolsContext } from '@solvapay/mcp'",
    "import { upstreamFetchJson } from '../lib/upstreamFetch'",
  ]
  if (needsAccessToken) importLines.push("import { getAccessToken } from '../lib/upstreamOAuth'")
  if (includesEnv) importLines.push("import type { Env } from '../worker'")

  return `${importLines.join('\n')}\n\nexport function ${signature} {\n${body}\n}\n`
}

function renderSchemaFields(operation, indent) {
  const pad = ' '.repeat(indent)
  const lines = []
  for (const param of operation.parameters) {
    lines.push(`${pad}${jsKey(param.name)}: ${zodForParam(param)},`)
  }
  if (operation.requestBody?.schema) {
    lines.push(`${pad}body: z.record(z.string(), z.unknown()).optional(),`)
  }
  if (lines.length === 0) return ''
  return lines.join('\n')
}

// Zod v4 record signature is `z.record(keyType, valueType)`. The v3
// single-argument form (`z.record(z.unknown())`) errors with "Expected
// 2-3 arguments, but got 1" under the template's pinned zod ^4.3.6.
//
// We preserve two pieces of spec fidelity here:
//   - Scalar string `enum`s become `z.enum([...])` (Zod's tagged union
//     form) so the LLM-facing tool schema lists the allowed values.
//   - Parameter `description` becomes a `.describe(...)` suffix so MCP
//     hosts can surface it in tool tooltips and `tools/list`.
// Complex bodies still fall through to the conservative
// `z.record(z.string(), z.unknown())` — chasing per-property fidelity
// for arbitrary JSON request bodies is intentionally out of scope; the
// description on the body parameter is still preserved.
function zodForParam(param) {
  const { type, format, required, enum: enumValues, description } = param
  let z
  if (type === 'integer') z = 'z.number().int()'
  else if (type === 'number') z = 'z.number()'
  else if (type === 'boolean') z = 'z.boolean()'
  else if (type === 'array') z = 'z.array(z.unknown())'
  else if (type === 'object') z = 'z.record(z.string(), z.unknown())'
  else if (isScalarStringEnum(enumValues, type)) z = `z.enum(${JSON.stringify(enumValues)})`
  else if (format === 'uuid') z = 'z.string().uuid()'
  else if (format === 'email') z = 'z.string().email()'
  else z = 'z.string()'

  if (description) {
    // Truncate to keep generated tool schemas readable. Long-form prose
    // belongs in the spec's `description` field, not inline in Zod.
    const shortened = shortenDescription(description)
    z = `${z}.describe(${JSON.stringify(shortened)})`
  }
  return required ? z : `${z}.optional()`
}

function isScalarStringEnum(enumValues, type) {
  if (!Array.isArray(enumValues) || enumValues.length === 0) return false
  if (type !== undefined && type !== 'string') return false
  return enumValues.every(v => typeof v === 'string')
}

function shortenDescription(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed
}

function renderUrlTemplate(baseUrl, operation) {
  let path = operation.path
  for (const param of operation.parameters.filter(p => p.in === 'path')) {
    path = path.replace(`{${param.name}}`, `\${input.${jsAccessor(param.name)}}`)
  }
  return `\`${joinUrl(baseUrl, path)}\``
}

function renderFetchInit(operation, headerLines) {
  const method = operation.method
  const hasBody = !!operation.requestBody?.schema && method !== 'GET' && method !== 'HEAD'
  const queryAssign = operation.parameters
    .filter(p => p.in === 'query')
    .map(p => {
      const access = `input.${jsAccessor(p.name)}`
      return `      if (${access} !== undefined) url.searchParams.set('${p.name}', String(${access}))`
    })
    .join('\n')

  const headersBlock = headerLines.length > 0
    ? `        headers: { ${headerLines.join(', ')} },\n`
    : ''
  const bodyBlock = hasBody ? '        body: JSON.stringify(input.body ?? {}),\n' : ''
  const methodBlock = `        method: '${method}',\n`

  return { method, queryAssign, headersBlock, bodyBlock, methodBlock }
}

function renderHeaderLines(auth, schemes, operation) {
  if (auth.kind === 'none') return []
  // Pick the first supported scheme this operation requires; fall back
  // to the top-level auth kind when the spec has no operation-level
  // security override.
  //
  // The static branches wrap `env.UPSTREAM_API_KEY` (typed `string | undefined`
  // in the template's `Env` interface) in a template literal so the
  // header value is `string`. If the secret is missing the worker still
  // sends the header with literal "undefined" — the recovery path
  // is uploading `UPSTREAM_API_KEY` to the Worker from `.env` via
  // deploy.mjs on first deploy (see deploy.md), not a compile-time
  // guard.
  //
  // The oauth2-client-credentials branch references a `token` variable
  // that the renderer injects right before URL construction in the
  // handler body (see renderPayableBody / renderFreeBody) via
  // `const token = await getAccessToken(env)`.
  const headerEntries = []
  if (auth.kind === 'bearer') {
    headerEntries.push("authorization: `Bearer ${env.UPSTREAM_API_KEY}`")
  } else if (auth.kind === 'apiKey') {
    headerEntries.push(`'${auth.name.toLowerCase()}': \`\${env.UPSTREAM_API_KEY}\``)
  } else if (auth.kind === 'oauth2-client-credentials') {
    headerEntries.push('authorization: `Bearer ${token}`')
  }
  if (operation.requestBody?.schema) {
    headerEntries.push("'content-type': 'application/json'")
  }
  return headerEntries
}

function renderPayableBody({ operation, urlTemplate, fetchInit, needsAccessToken }) {
  const schemaFields = renderSchemaFields(operation, 6)
  const schemaBlock = schemaFields ? `\n${schemaFields}\n    ` : ''
  const annotations = renderAnnotations(annotationsFor(operation), 4)
  const narration = JSON.stringify(`${operation.operationId} returned upstream data.`)
  const tokenLine = needsAccessToken ? '      const token = await getAccessToken(env)\n' : ''
  return `  ctx.registerPayable('${operation.operationId}', {
    title: ${JSON.stringify(operation.summary ?? operation.operationId)},
    description: ${JSON.stringify(buildDescription(operation))},
    schema: {${schemaBlock}},
    annotations: ${annotations},
    handler: async (input, c) => {
${tokenLine}      const url = new URL(${urlTemplate})
${fetchInit.queryAssign}
      const data = await upstreamFetchJson<Record<string, unknown>>(url, {
${fetchInit.methodBlock}${fetchInit.headersBlock}${fetchInit.bodyBlock}      })
      return c.respond(data, { text: ${narration} })
    },
  })`
}

function renderFreeBody({ operation, urlTemplate, fetchInit, needsAccessToken }) {
  const schemaFields = renderSchemaFields(operation, 8)
  const schemaBlock = schemaFields ? `\n${schemaFields}\n      ` : ''
  const annotations = renderAnnotations(annotationsFor(operation), 6)
  const narration = JSON.stringify(`${operation.operationId} returned upstream data.`)
  const tokenLine = needsAccessToken ? '      const token = await getAccessToken(env)\n' : ''
  return `  ctx.server.registerTool(
    '${operation.operationId}',
    {
      title: ${JSON.stringify(operation.summary ?? operation.operationId)},
      description: ${JSON.stringify(buildDescription(operation))},
      inputSchema: {${schemaBlock}},
      annotations: ${annotations},
    },
    async input => {
${tokenLine}      const url = new URL(${urlTemplate})
${fetchInit.queryAssign}
      const data = await upstreamFetchJson<Record<string, unknown>>(url, {
${fetchInit.methodBlock}${fetchInit.headersBlock}${fetchInit.bodyBlock}      })
      return {
        content: [{ type: 'text', text: ${narration} }],
        structuredContent: data,
      }
    },
  )`
}

function renderAnnotations(annotations, indent) {
  const pad = ' '.repeat(indent)
  const innerPad = ' '.repeat(indent + 2)
  const entries = Object.entries(annotations).map(([k, v]) => `${innerPad}${k}: ${JSON.stringify(v)}`)
  return `{\n${entries.join(',\n')},\n${pad}}`
}

function buildDescription(operation) {
  const base = operation.summary ?? operation.description ?? `${operation.method} ${operation.path}`
  return `${base} (${operation.method} ${operation.path}).`
}

function annotationsFor(operation) {
  const method = operation.method
  if (method === 'GET' || method === 'HEAD') {
    return { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
  }
  if (method === 'DELETE') {
    return { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }
  return { readOnlyHint: false, openWorldHint: true }
}

async function writeIndexFile(target, operationIds, authKind, mode) {
  // The template's `src/worker.ts` ships with
  // `additionalTools: ctx => registerTools(ctx, env)` baked in and scaffold
  // doesn't rewrite it. So `registerTools` ALWAYS takes `(ctx, env)` —
  // including for `upstreamAuth.kind === 'none'`, where `env` is in scope
  // but unused by the aggregator. Individual `register{OperationId}`
  // handlers still drop the `env` parameter when they don't need it; the
  // aggregator just forwards `env` only to the ones that take it.
  //
  // In intent-driven mode the agent owns this file: scaffold writes an
  // empty aggregator with a pointer comment, then the agent edits it as
  // it adds each intent tool (see intent-driven.md). The signature
  // matches one-to-one mode so the worker entrypoint is identical.
  const indexPath = join(target, 'src', 'tools', 'index.ts')
  if (mode === 'intent-driven') {
    const source = `import type { AdditionalToolsContext } from '@solvapay/mcp'
import type { Env } from '../worker'

export function registerTools(_ctx: AdditionalToolsContext, _env: Env) {
  // Intent tools registered here. See intent-driven.md.
  // After authoring src/tools/<intent>.ts, add:
  //   import { register<IntentName> } from './<intent>'
  // at the top, then call register<IntentName>(ctx, env) in this body
  // (and drop the underscore prefix on whichever parameters you use).
}
`
    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(indexPath, source, 'utf8')
    return
  }
  const opsNeedEnv = authKind !== 'none'
  const imports = operationIds
    .map(id => `import { register${capitalize(id)} } from './${id}'`)
    .join('\n')
  const calls = operationIds
    .map(id => (opsNeedEnv ? `  register${capitalize(id)}(ctx, env)` : `  register${capitalize(id)}(ctx)`))
    .join('\n')
  // When `opsNeedEnv` is false, `env` is intentionally unused in the
  // aggregator body. ESLint's `no-unused-vars` (which the template's
  // tsconfig doesn't enforce) and `tsc` are both fine with unused
  // parameters by default; the underscore convention is reserved for
  // cases where a linter is enabled.
  const source = `import type { AdditionalToolsContext } from '@solvapay/mcp'
import type { Env } from '../worker'
${imports}

export function registerTools(ctx: AdditionalToolsContext, env: Env) {
${calls}
}
`
  await mkdir(dirname(indexPath), { recursive: true })
  await writeFile(indexPath, source, 'utf8')
}

async function ensureGitignoreCoversEnv(target) {
  const path = join(target, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    existing = ''
  }
  if (/^\.env$/m.test(existing)) return
  const next = existing.endsWith('\n') || existing === '' ? existing : `${existing}\n`
  await writeFile(path, `${next}.env\n`, 'utf8')
}

async function writeDotEnv(target, selections) {
  const path = join(target, '.env')
  const productRef =
    typeof selections.solvapayProductRef === 'string'
      ? selections.solvapayProductRef
      : PLACEHOLDERS.PRODUCT_REF
  const lines = [
    '# Generated by create-solvapay scaffold.',
    '# SOLVAPAY_SECRET_KEY is populated by `npx solvapay init` (see solvapay-init.md).',
    `SOLVAPAY_PRODUCT_REF=${productRef}`,
    `MCP_PUBLIC_BASE_URL=${selections.mcpPublicBaseUrl}`,
  ]
  const auth = selections.upstreamAuth
  if (auth.kind === 'bearer' || auth.kind === 'apiKey') {
    lines.push(`UPSTREAM_API_KEY=${auth.key}`)
  } else if (auth.kind === 'oauth2-client-credentials') {
    lines.push(`UPSTREAM_OAUTH_TOKEN_URL=${auth.tokenUrl}`)
    lines.push(`UPSTREAM_OAUTH_CLIENT_ID=${auth.clientId}`)
    lines.push(`UPSTREAM_OAUTH_CLIENT_SECRET=${auth.clientSecret}`)
    if (typeof auth.scope === 'string' && auth.scope.length > 0) {
      lines.push(`UPSTREAM_OAUTH_SCOPE=${auth.scope}`)
    }
    if (typeof auth.audience === 'string' && auth.audience.length > 0) {
      lines.push(`UPSTREAM_OAUTH_AUDIENCE=${auth.audience}`)
    }
  }
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

function secretsSeededFor(auth) {
  const out = []
  if (auth.kind === 'bearer' || auth.kind === 'apiKey') {
    out.push({ name: 'UPSTREAM_API_KEY', location: '.env' })
  } else if (auth.kind === 'oauth2-client-credentials') {
    out.push({ name: 'UPSTREAM_OAUTH_TOKEN_URL', location: '.env' })
    out.push({ name: 'UPSTREAM_OAUTH_CLIENT_ID', location: '.env' })
    out.push({ name: 'UPSTREAM_OAUTH_CLIENT_SECRET', location: '.env' })
    if (typeof auth.scope === 'string' && auth.scope.length > 0) {
      out.push({ name: 'UPSTREAM_OAUTH_SCOPE', location: '.env' })
    }
    if (typeof auth.audience === 'string' && auth.audience.length > 0) {
      out.push({ name: 'UPSTREAM_OAUTH_AUDIENCE', location: '.env' })
    }
  }
  out.push({ name: 'SOLVAPAY_PRODUCT_REF', location: '.env' })
  out.push({ name: 'MCP_PUBLIC_BASE_URL', location: '.env (localhost placeholder; auto-resolved on deploy)' })
  return out
}

function collectWrittenPaths(target, toolFiles, envPath) {
  const written = [
    join(target, 'src', 'tools', 'index.ts'),
    join(target, '.gitignore'),
    envPath,
  ]
  for (const id of toolFiles) {
    written.push(join(target, 'src', 'tools', `${id}.ts`))
  }
  return written.map(p => relative(process.cwd(), p))
}

function jsKey(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

function jsAccessor(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `[${JSON.stringify(name)}]`
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function joinUrl(base, path) {
  const trimmed = base.replace(/\/$/, '')
  const prefix = path.startsWith('/') ? path : `/${path}`
  return `${trimmed}${prefix}`
}

main().catch(err => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
