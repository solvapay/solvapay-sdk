#!/usr/bin/env node
/* global console, process */
/**
 * Deploy wrapper for the checkout-demo Cloudflare Worker (OpenNext).
 *
 *   pnpm deploy           -> wrangler deploy                   (sources `.env`)
 *   pnpm deploy:prod      -> wrangler deploy --env production  (sources `.env.prod`)
 *
 * Run `pnpm build:opennext` or `pnpm build:opennext:prod` before deploy.
 *
 * Secrets (one-time per Worker):
 *   wrangler secret put SOLVAPAY_SECRET_KEY --env production
 *   wrangler secret put SUPABASE_JWT_SECRET --env production
 *
 * `CLOUDFLARE_ACCOUNT_ID` is not a Worker var. Wrangler does not
 * expand `${CLOUDFLARE_ACCOUNT_ID}` in wrangler.jsonc, so this script
 * reads it from the process env or the dotenv file and forwards it as
 * a real environment variable. Prod deploys fail if it is missing.
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const commentIdx = value.search(/\s+#/)
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim()
    }
    env[key] = value
  }
  return env
}

const localEnv = existsSync(dotEnvPath) ? parseDotEnv(readFileSync(dotEnvPath, 'utf8')) : {}

if (!existsSync(dotEnvPath)) {
  const secretCmds = isProd
    ? [
        'wrangler secret put SOLVAPAY_SECRET_KEY --env production',
        'wrangler secret put SUPABASE_JWT_SECRET --env production',
      ]
    : ['wrangler secret put SOLVAPAY_SECRET_KEY', 'wrangler secret put SUPABASE_JWT_SECRET']
  const exampleFile = isProd ? '.env.prod.example' : 'env.example'
  console.error(
    [
      '',
      `⚠  ${dotEnvPath} not found — deploying without dotenv overrides.`,
      `   Copy ${exampleFile} to ${dotEnvFile} for deploy-time --var overrides.`,
      '   Set secrets once with:',
      ...secretCmds.map(c => `     ${c}`),
      '',
    ].join('\n'),
  )
}

const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? localEnv.CLOUDFLARE_ACCOUNT_ID ?? '').trim()

if (isProd && !accountId) {
  console.error(
    [
      '',
      'CLOUDFLARE_ACCOUNT_ID is not set. Wrangler does not expand',
      '`${CLOUDFLARE_ACCOUNT_ID}` in wrangler.jsonc, so the account must',
      'come from the environment.',
      `Add it to ${dotEnvFile} (see .env.prod.example) or export it`,
      'in your shell. Find it with:',
      '  pnpm exec wrangler whoami',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const wranglerArgs = ['exec', 'wrangler', 'deploy']
if (isProd) {
  wranglerArgs.push('--env', 'production')
} else {
  // Target top-level wrangler config when [env.production] is also defined
  wranglerArgs.push('--env', '')
}
for (const name of OVERRIDABLE_VARS) {
  const value = localEnv[name]
  if (value) wranglerArgs.push('--var', `${name}:${value}`)
}
wranglerArgs.push(...passthrough)

const childEnv = accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId } : process.env

const result = spawnSync('pnpm', wranglerArgs, {
  cwd: exampleRoot,
  stdio: 'inherit',
  env: childEnv,
})

if (result.status === 0) {
  const envFlag = isProd ? ' --env production' : ''
  const target = isProd ? 'production Worker' : 'Worker'
  console.error(
    [
      '',
      `ℹ  Deploy succeeded. If /api/* returns 500 ("error code: 1101"),`,
      `   the ${target} may be missing secrets. Verify:`,
      `     wrangler secret list${envFlag}`,
      '   Upload with:',
      `     wrangler secret put SOLVAPAY_SECRET_KEY${envFlag}`,
      `     wrangler secret put SUPABASE_JWT_SECRET${envFlag}`,
      '',
    ].join('\n'),
  )
}

process.exit(result.status ?? 1)
