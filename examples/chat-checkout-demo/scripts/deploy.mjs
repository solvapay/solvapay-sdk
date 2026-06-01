#!/usr/bin/env node
/* global console, process */
/**
 * Deploy wrapper for the chat-checkout-demo Cloudflare Worker.
 *
 * `wrangler deploy` uploads the `vars` block from `wrangler.jsonc` on
 * every run. That file ships safe public-starter placeholders so
 * anyone who clones this repo can deploy without accidentally
 * connecting to someone else's merchant or backend environment.
 *
 * For *your* Worker, override those placeholders at deploy time by
 * putting real values in a local dotenv file (gitignored — see
 * `.env.example` / `.env.prod.example` for the full lists). This
 * script sources that file and passes the overridable keys as `--var`
 * flags to `wrangler deploy`, so the repo stays clean while your
 * deploys continue pointing at the right backend origin.
 *
 * Two deploy targets:
 *
 *   pnpm deploy           -> wrangler deploy                   (sources `.env`)
 *   pnpm deploy:prod      -> wrangler deploy --env production  (sources `.env.prod`)
 *
 * The `--prod` flag (or `DEPLOY_ENV=prod`) selects the prod target.
 *
 * `SOLVAPAY_SECRET_KEY` and `GEMINI_API_KEY` are managed separately
 * as Worker secrets — for prod, scope them with `--env production`:
 *   wrangler secret put SOLVAPAY_SECRET_KEY --env production
 *   wrangler secret put GEMINI_API_KEY --env production
 * Run once each, persists across deploys. They're listed in the
 * dotenv files so `wrangler dev` can use them for local testing, but
 * this script does NOT re-upload them on every deploy; secrets belong
 * out of deploy-time plaintext.
 *
 * Pass-through: any extra CLI args (e.g. `--dry-run`) are forwarded
 * to `wrangler deploy`. The `--prod` token is stripped before
 * forwarding so it doesn't leak through to wrangler.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const exampleRoot = resolve(here, '..')

const passthroughArgs = process.argv.slice(2)
const isProd = passthroughArgs.includes('--prod') || process.env.DEPLOY_ENV === 'prod'
const passthrough = passthroughArgs.filter(arg => arg !== '--prod')

const dotEnvFile = isProd ? '.env.prod' : '.env'
const dotEnvPath = resolve(exampleRoot, dotEnvFile)

const OVERRIDABLE_VARS = ['SOLVAPAY_API_BASE_URL']

function parseDotEnv(contents) {
  const env = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
    if (!match) continue
    let [, key, value] = match
    value = value.trim()
    // Strip a single layer of matching quotes (e.g. VALUE="foo" or 'foo').
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      // Unquoted values: strip inline comment starting with whitespace+`#`.
      const commentIdx = value.search(/\s+#/)
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim()
    }
    env[key] = value
  }
  return env
}

const localEnv = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, 'utf8')) : {}

if (!existsSync(dotEnvPath)) {
  const wranglerEnvNote = isProd ? ' [env.production]' : ''
  const secretCmds = isProd
    ? [
        'wrangler secret put SOLVAPAY_SECRET_KEY --env production',
        'wrangler secret put GEMINI_API_KEY --env production',
      ]
    : ['wrangler secret put SOLVAPAY_SECRET_KEY', 'wrangler secret put GEMINI_API_KEY']
  const exampleFile = isProd ? '.env.prod.example' : '.env.example'
  console.error(
    [
      '',
      `⚠  ${dotEnvPath} not found — deploying with placeholder vars`,
      `   from wrangler.jsonc${wranglerEnvNote}.`,
      `   Copy ${exampleFile} to ${dotEnvFile} and fill in your`,
      '   values to override the committed placeholders at deploy time.',
      '   Set the secrets once with:',
      ...secretCmds.map(c => `     ${c}`),
      '',
    ].join('\n'),
  )
}

const wranglerArgs = ['exec', 'wrangler', 'deploy']
if (isProd) wranglerArgs.push('--env', 'production')
for (const name of OVERRIDABLE_VARS) {
  const value = localEnv[name]
  if (value) wranglerArgs.push('--var', `${name}:${value}`)
}
wranglerArgs.push(...passthrough)

const result = spawnSync('pnpm', wranglerArgs, {
  cwd: exampleRoot,
  stdio: 'inherit',
})

if (result.status === 0) {
  // Wrangler doesn't tell you if secrets are missing — the Worker
  // deploys fine and only fails at request time with a 500 + Cloudflare
  // `error code: 1101` page. Surface a reminder here so the failure mode
  // is visible without tailing logs.
  const envFlag = isProd ? ' --env production' : ''
  const target = isProd ? 'production Worker' : 'Worker'
  console.error(
    [
      '',
      `ℹ  Deploy succeeded. If /api/* requests return 500 ("error code:`,
      `   1101"), the ${target} is missing secrets. Verify with:`,
      `     wrangler secret list${envFlag}`,
      '   Upload (or rotate) with:',
      `     wrangler secret put SOLVAPAY_SECRET_KEY${envFlag}`,
      `     wrangler secret put GEMINI_API_KEY${envFlag}`,
      '',
    ].join('\n'),
  )
}

process.exit(result.status ?? 1)
