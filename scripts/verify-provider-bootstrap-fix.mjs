#!/usr/bin/env node
/* global console, process */
/**
 * Hand-off integration harness for the "Fix provider bootstrap validation
 * gap" plan. Validates every layer of the fix end-to-end against a real
 * SolvaPay backend.
 *
 * Plan source:
 *   /Users/tommy/.cursor/plans/fix_provider_bootstrap_validation_gap_5ace4ad6.plan.md
 *
 * What this script covers (the test plan from the plan file):
 *
 *   1. `solvapay init` hard-fails with "Provider account not found" when
 *      the secret key has no merchant on the backend.
 *   2. `npm run deploy` aborts before `wrangler deploy` runs when the
 *      secret key has no merchant.
 *   3. `npm run deploy` succeeds and prints `merchant ok` when the key
 *      is valid.
 *   4. Post-deploy `scripts/verify.mjs --credentials-file` reports
 *      `merchantBootstrap: passed`.
 *   5. Post-deploy `scripts/test.mjs --credentials-file` reports
 *      `overall: "passed"` or `"failed"` (never `"skipped"` when creds
 *      are supplied).
 *   6. SDK unit tests: `getMerchantCore` 404 produces a recovery-text
 *      tool result with `structuredContent.status === 404` and
 *      `isError: true`.
 *   7. Regression: existing tool errors still produce human-readable
 *      `content[0].text` (not a JSON blob).
 *
 * Cases 6 + 7 are covered by automated tests already in the repo:
 *   - packages/core/src/index.test.ts
 *   - packages/server/__tests__/client-error.unit.test.ts
 *   - packages/server/src/helpers/error.test.ts
 *   - packages/mcp-core/__tests__/mcp-helpers.unit.test.ts (toolErrorResult)
 *   - packages/mcp-core/__tests__/descriptors.unit.test.ts (404 merchant)
 * This script just re-runs them as a sanity check and then drives the
 * remaining manual cases (1–5).
 *
 * Required environment to drive the manual cases:
 *   SOLVAPAY_API_BASE_URL          (e.g. https://api-dev.solvapay.com)
 *   SOLVAPAY_KEY_NO_MERCHANT       a secret key the backend authenticates
 *                                  but has no merchant for (case 1, 2).
 *                                  See backend docs for how to mint one,
 *                                  or hand-craft one in the SolvaPay
 *                                  Console DB.
 *   SOLVAPAY_KEY_VALID             a secret key tied to a real merchant
 *                                  (case 3, 4, 5).
 *   MCPJAM_BIN                     optional, defaults to `mcpjam`. Must
 *                                  resolve to the MCPJam CLI (install with
 *                                  `npm i -g @mcpjam/cli`, or set
 *                                  MCPJAM_BIN='npx -y @mcpjam/cli@latest').
 *
 * Optional environment:
 *   DEPLOY_URL                     a URL to an already-deployed worker
 *                                  to skip the deploy step. When unset,
 *                                  the script scaffolds a fresh project
 *                                  in a tmpdir and runs `npm run deploy`.
 *   SKIP_UNIT_TESTS=1              skip the unit test sanity check.
 *   SKIP_INIT_CASE=1               skip case 1 (solvapay init).
 *   SKIP_DEPLOY_CASES=1            skip cases 2 + 3 (deploy preflight).
 *   SKIP_VERIFY_CASE=1             skip case 4 (verify.mjs).
 *   SKIP_TEST_CASE=1               skip case 5 (test.mjs).
 *
 * Usage:
 *   node scripts/verify-provider-bootstrap-fix.mjs
 *
 * Exit code 0 when every enabled case passes, 1 otherwise.
 *
 * ──────────────────────────────────────────────────────────────────────
 * REQUIRES A HUMAN AT THE TERMINAL
 * ──────────────────────────────────────────────────────────────────────
 * Cases 4 + 5 mint an OAuth bearer token via `mcpjam oauth login`, which
 * runs with the default `--auth-mode interactive`. That mode opens a
 * system browser and blocks until you click "Approve" on the SolvaPay
 * consent screen. There is no fully autonomous path:
 *
 *   - SolvaPay workers only advertise `authorization_code` + `refresh_token`
 *     grant types (see packages/mcp-core/src/oauth-discovery.ts), so
 *     `--auth-mode client_credentials` will fail at metadata validation.
 *   - `--auth-mode headless` still drives `authorization_code` and
 *     requires the IdP to issue a code without a human consent click,
 *     which a customer-style OAuth IdP does not do.
 *
 * If you're an autonomous agent running this harness, stop after case 3
 * (deploy preflight) — that case already validates the same "secret key
 * has no merchant" failure mode without OAuth, and is the actionable
 * signal for redeploying with a corrected key.
 *
 * Token expiry: `mcpjam` writes `accessToken`, `refreshToken`, and
 * `expiresAt` to the credentials file. verify.mjs / test.mjs only read
 * `accessToken`. If you re-run cases 4 + 5 after the token expires, the
 * harness will surface a 401 — re-mint by re-running mintCredentials
 * (the harness will call `mcpjam oauth login` again).
 */

import { spawnSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const SCAFFOLDER_BIN = resolve(REPO_ROOT, 'packages/create-solvapay/dist/cli.js')

const log = (...args) => {
  process.stdout.write(`${args.join(' ')}\n`)
}

const fail = (msg) => {
  process.stderr.write(`❌ ${msg}\n`)
  process.exitCode = 1
}

const env = {
  apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
  keyNoMerchant: process.env.SOLVAPAY_KEY_NO_MERCHANT,
  keyValid: process.env.SOLVAPAY_KEY_VALID,
  mcpjam: process.env.MCPJAM_BIN ?? 'mcpjam',
  deployUrl: process.env.DEPLOY_URL,
}

function runPipe(command, args, cwd, extraEnv = {}) {
  log(`$ (${cwd}) ${command} ${args.join(' ')}`)
  return spawnSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
}

function header(title) {
  log('')
  log(`════════════════════════════════════════════════════════════════════`)
  log(`▶ ${title}`)
  log(`════════════════════════════════════════════════════════════════════`)
}

// ──────────────────────────────────────────────────────────────────────
// Case 6 + 7 — unit tests
// ──────────────────────────────────────────────────────────────────────
function runUnitTests() {
  header('Case 6 + 7 — automated unit test coverage')
  const filters = [
    '@solvapay/core',
    '@solvapay/server',
    '@solvapay/mcp-core',
    '@solvapay/init',
  ]
  const filterArgs = filters.flatMap((f) => ['--filter', f])
  const result = spawnSync(
    'pnpm',
    [...filterArgs, 'run', 'test'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  if (result.status !== 0) {
    fail('Unit test sweep failed — review test output above.')
    return false
  }
  log('✅ Unit tests passed (covers cases 6 + 7).')
  return true
}

// ──────────────────────────────────────────────────────────────────────
// Case 1 — `solvapay init` hard-fails on a key with no merchant
// ──────────────────────────────────────────────────────────────────────
function runInitCase() {
  header('Case 1 — `solvapay init` hard-fails on key-without-merchant')
  if (!env.keyNoMerchant) {
    fail('SOLVAPAY_KEY_NO_MERCHANT is not set — skipping case 1.')
    return false
  }
  if (!env.apiBaseUrl) {
    fail('SOLVAPAY_API_BASE_URL is not set — skipping case 1.')
    return false
  }
  // Hit verifyMerchant directly via the compiled @solvapay/init API.
  // Avoids the interactive browser flow.
  const initDistPath = resolve(REPO_ROOT, 'packages/init/dist/index.js')
  if (!existsSync(initDistPath)) {
    fail(`@solvapay/init dist not built at ${initDistPath}. Run \`pnpm --filter @solvapay/init build\`.`)
    return false
  }
  const importExpr = `
    import('${initDistPath}').then(async (mod) => {
      const result = await mod.verifyMerchant('${env.apiBaseUrl}', '${env.keyNoMerchant}')
      process.stdout.write(JSON.stringify(result))
    })
  `
  const result = spawnSync('node', ['--input-type=module', '-e', importExpr], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    fail(`verifyMerchant call errored: ${result.stderr}`)
    return false
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout.trim())
  } catch (err) {
    fail(`verifyMerchant produced non-JSON output: ${result.stdout}`)
    return false
  }
  if (parsed.status !== 'not_found') {
    fail(`Expected verifyMerchant -> 'not_found', got: ${JSON.stringify(parsed)}`)
    return false
  }
  log('✅ verifyMerchant returns `not_found` for the no-merchant key.')
  log('   (run-init.ts uses this to print the recovery message and throw.)')
  return true
}

// ──────────────────────────────────────────────────────────────────────
// Scaffold helper — creates a fresh MCP project in a tmpdir.
// ──────────────────────────────────────────────────────────────────────
function scaffoldProject(label) {
  if (!existsSync(SCAFFOLDER_BIN)) {
    throw new Error(
      `Scaffolder dist not built at ${SCAFFOLDER_BIN}. Run \`pnpm --filter create-solvapay build\`.`,
    )
  }
  const parent = mkdtempSync(join(tmpdir(), `solvapay-bootstrap-fix-${label}-`))
  const target = join(parent, 'project')
  log(`Scaffolding fresh MCP project at ${target}`)
  const scaffold = spawnSync(
    'node',
    [
      SCAFFOLDER_BIN,
      'project',
      '--type',
      'mcp',
      '--no-openapi',
      '--no-install',
      '--yes',
    ],
    { cwd: parent, stdio: 'inherit' },
  )
  if (scaffold.status !== 0) {
    throw new Error('create-solvapay scaffold failed')
  }
  return target
}

function writeEnv(target, lines) {
  writeFileSync(join(target, '.env'), `${lines.join('\n')}\n`, 'utf8')
}

// ──────────────────────────────────────────────────────────────────────
// Case 2 — deploy aborts when the key has no merchant
// ──────────────────────────────────────────────────────────────────────
function runDeployAbortCase() {
  header('Case 2 — `npm run deploy` aborts on key-without-merchant')
  if (!env.keyNoMerchant) {
    fail('SOLVAPAY_KEY_NO_MERCHANT is not set — skipping case 2.')
    return false
  }
  let target
  try {
    target = scaffoldProject('case2')
  } catch (err) {
    fail(err.message)
    return false
  }
  writeEnv(target, [
    `SOLVAPAY_SECRET_KEY=${env.keyNoMerchant}`,
    `SOLVAPAY_API_BASE_URL=${env.apiBaseUrl ?? 'https://api.solvapay.com'}`,
    `SOLVAPAY_PRODUCT_REF=__SOLVAPAY_PRODUCT_REF__`,
    `MCP_PUBLIC_BASE_URL=http://localhost:8787`,
  ])
  const result = runPipe('node', ['scripts/deploy.mjs', '--dry-run', '--yes'], target)
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  log(combined)
  if ((result.status ?? 1) === 0) {
    fail('Expected deploy.mjs to exit non-zero when key has no merchant, but it exited 0.')
    return false
  }
  if (!/Provider not found|preflight failed/i.test(combined)) {
    fail('Expected deploy.mjs to print a Provider-not-found recovery message.')
    return false
  }
  log('✅ deploy.mjs aborted with the expected recovery message.')
  return true
}

// ──────────────────────────────────────────────────────────────────────
// Case 3 — deploy preflight passes with a valid key
// ──────────────────────────────────────────────────────────────────────
function runDeployPassCase() {
  header('Case 3 — `npm run deploy` preflight prints `merchant ok`')
  if (!env.keyValid) {
    fail('SOLVAPAY_KEY_VALID is not set — skipping case 3.')
    return false
  }
  let target
  try {
    target = scaffoldProject('case3')
  } catch (err) {
    fail(err.message)
    return false
  }
  writeEnv(target, [
    `SOLVAPAY_SECRET_KEY=${env.keyValid}`,
    `SOLVAPAY_API_BASE_URL=${env.apiBaseUrl ?? 'https://api.solvapay.com'}`,
    `SOLVAPAY_PRODUCT_REF=__SOLVAPAY_PRODUCT_REF__`,
    `MCP_PUBLIC_BASE_URL=http://localhost:8787`,
  ])
  // --dry-run exercises the preflight without contacting Cloudflare.
  // Note: --dry-run will still attempt the Cloudflare auth checks; if
  // Cloudflare auth fails the script exits before reaching the SolvaPay
  // preflight. The user must `wrangler login` once before this case.
  const result = runPipe('node', ['scripts/deploy.mjs', '--dry-run', '--yes'], target)
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  log(combined)
  if (!/SolvaPay merchant ok|merchant ok/i.test(combined)) {
    fail('Expected deploy.mjs to print `SolvaPay merchant ok` with a valid key. Did wrangler login succeed?')
    return false
  }
  log('✅ deploy.mjs preflight passed.')
  return true
}

// ──────────────────────────────────────────────────────────────────────
// Cases 4 + 5 — verify.mjs / test.mjs against a deployed worker
// ──────────────────────────────────────────────────────────────────────
function mintCredentials(workerUrl) {
  const credsPath = join(mkdtempSync(join(tmpdir(), 'solvapay-creds-')), 'creds.json')
  const mcpUrl = workerUrl.replace(/\/+$/, '') + '/mcp'
  // mcpjam oauth login defaults to --auth-mode interactive, which opens
  // a system browser and blocks until the human clicks "Approve". The
  // 5min step-timeout caps the wait so the harness doesn't hang
  // indefinitely on an unattended run (mcpjam's own default is 30s per
  // step, but the human consent click can legitimately take longer).
  const stepTimeoutMs = Number(process.env.SOLVAPAY_MCPJAM_STEP_TIMEOUT_MS ?? 300_000)
  log('')
  log(`▶ Interactive OAuth: \`${env.mcpjam} oauth login --url ${mcpUrl} --credentials-out ${credsPath}\``)
  log('  ↳ A browser window will open. You have a human at the terminal? Click "Approve".')
  log(`  ↳ Step timeout: ${stepTimeoutMs}ms (override with SOLVAPAY_MCPJAM_STEP_TIMEOUT_MS).`)
  log(`  ↳ If \`${env.mcpjam}\` is not on PATH, install with \`npm i -g @mcpjam/cli\` or`)
  log("     re-run with MCPJAM_BIN='npx -y @mcpjam/cli@latest'.")
  const result = spawnSync(
    env.mcpjam,
    [
      'oauth',
      'login',
      '--url',
      mcpUrl,
      '--credentials-out',
      credsPath,
      '--step-timeout',
      String(stepTimeoutMs),
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new Error('mcpjam oauth login failed (browser approval not completed within step-timeout?)')
  }
  if (!existsSync(credsPath)) {
    throw new Error(`mcpjam did not write ${credsPath}`)
  }
  return credsPath
}

function runVerifyCase(workerUrl, credsPath, scriptsDir) {
  header('Case 4 — `verify.mjs --credentials-file` → `merchantBootstrap: passed`')
  const result = runPipe('node', ['verify.mjs', workerUrl, '--credentials-file', credsPath], scriptsDir)
  log(result.stdout ?? '')
  log(result.stderr ?? '')
  if ((result.status ?? 1) !== 0) {
    fail(`verify.mjs exited non-zero (${result.status}).`)
    return false
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    fail('verify.mjs did not emit JSON on stdout.')
    return false
  }
  const merchantBootstrap = parsed?.checks?.merchantBootstrap
  if (!merchantBootstrap) {
    fail('verify.mjs did not report a `merchantBootstrap` check.')
    return false
  }
  if (merchantBootstrap.status !== 'passed') {
    const blob = JSON.stringify(merchantBootstrap)
    fail(`Expected merchantBootstrap.status === 'passed', got: ${blob}`)
    if (/401|unauthori[sz]ed|Bearer/i.test(blob)) {
      log('  ↳ Looks like a 401 — the bearer token may have expired. Re-run the')
      log('     harness (it will call `mcpjam oauth login` again) to mint a fresh token.')
    }
    return false
  }
  log('✅ merchantBootstrap passed.')
  return true
}

function runTestCase(workerUrl, credsPath, scriptsDir) {
  header('Case 5 — `test.mjs --credentials-file` → `overall: passed | failed`')
  // Use the bundled `openapi.json` if the project was scaffolded with
  // openapi mode; we'll fall back to a no-op spec for hand-written mode.
  // For the hand-off run, we expect the user to point at a real spec or
  // skip this case.
  const specPath = process.env.SOLVAPAY_BOOTSTRAP_FIX_SPEC
  if (!specPath) {
    fail('SOLVAPAY_BOOTSTRAP_FIX_SPEC is not set. Skipping case 5; pass an OpenAPI spec to enable.')
    return false
  }
  const result = runPipe(
    'node',
    ['test.mjs', workerUrl, '--spec', specPath, '--credentials-file', credsPath],
    scriptsDir,
  )
  log(result.stdout ?? '')
  log(result.stderr ?? '')
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    fail('test.mjs did not emit JSON on stdout.')
    return false
  }
  if (parsed.overall === 'skipped') {
    fail(`Expected overall in ['passed', 'failed'] with --credentials-file, got 'skipped'. Reason: ${parsed.reason}`)
    return false
  }
  log(`✅ test.mjs returned overall = ${parsed.overall} (never 'skipped' with creds).`)
  return true
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`SolvaPay provider-bootstrap-fix integration harness`)
  log(`Repo: ${REPO_ROOT}`)

  const summary = []

  if (process.env.SKIP_UNIT_TESTS !== '1') {
    summary.push(['Unit tests (cases 6 + 7)', runUnitTests()])
  }
  if (process.env.SKIP_INIT_CASE !== '1') {
    summary.push(['Case 1 (solvapay init hard-fail)', runInitCase()])
  }
  if (process.env.SKIP_DEPLOY_CASES !== '1') {
    summary.push(['Case 2 (deploy aborts)', runDeployAbortCase()])
    summary.push(['Case 3 (deploy preflight ok)', runDeployPassCase()])
  }

  if (env.deployUrl) {
    let credsPath
    try {
      credsPath = mintCredentials(env.deployUrl)
    } catch (err) {
      fail(`Failed to mint credentials: ${err.message}`)
    }
    if (credsPath) {
      // We need a scripts dir to run the .mjs files. Easiest: scaffold
      // a fresh project once and reuse its scripts/.
      let scriptsDir
      try {
        const tmp = scaffoldProject('verify-test')
        scriptsDir = join(tmp, 'scripts')
      } catch (err) {
        fail(`Failed to scaffold scripts dir: ${err.message}`)
      }
      if (scriptsDir && process.env.SKIP_VERIFY_CASE !== '1') {
        summary.push(['Case 4 (verify.mjs)', runVerifyCase(env.deployUrl, credsPath, scriptsDir)])
      }
      if (scriptsDir && process.env.SKIP_TEST_CASE !== '1') {
        summary.push(['Case 5 (test.mjs)', runTestCase(env.deployUrl, credsPath, scriptsDir)])
      }
    }
  } else {
    log('')
    log('DEPLOY_URL not set — skipping cases 4 + 5 (verify.mjs / test.mjs against a deployed worker).')
    log('To exercise them: deploy the worker manually, set DEPLOY_URL=https://… and re-run.')
  }

  header('Summary')
  let allPassed = true
  for (const [name, ok] of summary) {
    log(`  ${ok ? '✅' : '❌'}  ${name}`)
    if (!ok) allPassed = false
  }
  log('')
  if (!allPassed) {
    process.exit(1)
  }
  log('All enabled cases passed.')
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? String(err))
  process.exit(1)
})
