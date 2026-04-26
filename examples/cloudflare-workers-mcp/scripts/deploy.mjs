#!/usr/bin/env node
/**
 * Deploy wrapper for the Cloudflare Workers MCP example.
 *
 * `wrangler deploy` uploads the `vars` block from `wrangler.jsonc` on
 * every run. That file ships safe public-starter placeholders
 * (`prd_your_product_ref`, `https://your-worker.example.com`, …) so
 * anyone who clones this repo can deploy without accidentally
 * connecting to someone else's merchant or backend environment.
 *
 * For *your* Worker, override those placeholders at deploy time by
 * putting real values in a local `.env` file (gitignored — see
 * `.env.example` for the full list). This script sources that file
 * and passes the three overridable keys as `--var` flags to
 * `wrangler deploy`, so the repo stays clean while your deploys
 * continue pointing at the right merchant + API origin.
 *
 * `SOLVAPAY_SECRET_KEY` is managed separately as a Worker secret
 * (`wrangler secret put SOLVAPAY_SECRET_KEY` — run once, persists
 * across deploys). It's listed in `.env` so `wrangler dev` can use
 * it for local testing, but this script does NOT re-upload it on
 * every deploy; secrets belong out of deploy-time plaintext.
 *
 * Pass-through: any extra CLI args (e.g. `--dry-run`) are forwarded
 * to `wrangler deploy`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const exampleRoot = resolve(here, '..')
const dotEnvPath = resolve(exampleRoot, '.env')

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

const localEnv = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, 'utf8')) : {}

if (!existsSync(dotEnvPath)) {
  console.error(
    [
      '',
      `⚠  ${dotEnvPath} not found — deploying with placeholder vars from wrangler.jsonc.`,
      '   Copy .env.example to .env and fill in your SolvaPay values',
      '   to override the committed placeholders at deploy time.',
      '',
    ].join('\n'),
  )
}

const wranglerArgs = ['exec', 'wrangler', 'deploy']
for (const name of OVERRIDABLE_VARS) {
  const value = localEnv[name]
  if (value) wranglerArgs.push('--var', `${name}:${value}`)
}
wranglerArgs.push(...process.argv.slice(2))

const result = spawnSync('pnpm', wranglerArgs, {
  cwd: exampleRoot,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
