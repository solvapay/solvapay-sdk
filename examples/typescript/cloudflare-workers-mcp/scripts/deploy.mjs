#!/usr/bin/env node
/* global console, process */
/**
 * Deploy wrapper for the Cloudflare Workers MCP example.
 *
 * `wrangler deploy` uploads the `vars` block from `wrangler.jsonc` on
 * every run. That file ships safe public-starter placeholders
 * (`prd_your_product_ref`, `https://your-worker.example.com`, …) so
 * anyone who clones this repo can deploy without accidentally
 * connecting to someone else's merchant or backend environment. The
 * `[env.production]` block (used for the goldberg-demo live deploy)
 * ships its own placeholders for the same reason.
 *
 * For *your* Worker, override those placeholders at deploy time by
 * putting real values in a local dotenv file (gitignored — see
 * `.env.example` / `.env.prod.example` for the full lists). This
 * script sources that file and passes the overridable keys as `--var`
 * flags to `wrangler deploy`, so the repo stays clean while your
 * deploys continue pointing at the right merchant + API origin.
 *
 * Two deploy targets:
 *
 *   pnpm deploy           -> wrangler deploy                   (sources `.env`)
 *   pnpm deploy:prod      -> wrangler deploy --env production  (sources `.env.prod`)
 *
 * The `--prod` flag (or `DEPLOY_ENV=prod`) selects the prod target.
 *
 * `SOLVAPAY_SECRET_KEY` is managed separately as a Worker secret —
 * for prod, scope it with `--env production`:
 *   wrangler secret put SOLVAPAY_SECRET_KEY --env production
 * Run once, persists across deploys. It's listed in the dotenv files
 * so `wrangler dev` can use it for local testing, but this script
 * does NOT re-upload it on every deploy; secrets belong out of
 * deploy-time plaintext.
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

const OVERRIDABLE_VARS = [
  'SOLVAPAY_PRODUCT_REF',
  'MCP_PUBLIC_BASE_URL',
  'SOLVAPAY_API_BASE_URL',
]

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
    // Comments inside quoted values are preserved as part of the value,
    // matching standard dotenv semantics (dotenv npm v15+, wrangler's
    // built-in `.env` parser).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      // Unquoted values: strip inline comment starting with whitespace+`#`.
      // Without this, `FOO=bar # note` yields `bar # note` — different from
      // what `wrangler dev` sees for the same dotenv file, which would
      // produce a silent "works locally, broken in deploy" split.
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
  const secretCmd = isProd
    ? 'wrangler secret put SOLVAPAY_SECRET_KEY --env production'
    : 'wrangler secret put SOLVAPAY_SECRET_KEY'
  const exampleFile = isProd ? '.env.prod.example' : '.env.example'
  console.error(
    [
      '',
      `⚠  ${dotEnvPath} not found — deploying with placeholder vars`,
      `   from wrangler.jsonc${wranglerEnvNote}.`,
      `   Copy ${exampleFile} to ${dotEnvFile} and fill in your`,
      '   values to override the committed placeholders at deploy time.',
      '   Set the secret once with:',
      `     ${secretCmd}`,
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

process.exit(result.status ?? 1)
