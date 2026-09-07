#!/usr/bin/env node
/* global console, process */
/**
 * Pre-deploy checks for the goldberg-demo dev Worker
 * (`pnpm deploy:dev` -> solvapay-mcp-goldberg-dev).
 *
 * Validates `.env.dev`, build artifacts, and wrangler auth before
 * publishing to https://goldberg-demo-dev.solvapay.app.
 *
 * Usage:
 *   node scripts/preflight-dev.mjs
 *   node scripts/preflight-dev.mjs --allow-live   # warn only on sk_live
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const exampleRoot = resolve(here, '..')
const allowLive = process.argv.includes('--allow-live')

const PLACEHOLDER = /your_|replace_me|sk_test_your|sk_live_your|prd_your/i
const DEV_PUBLIC_URL = 'https://goldberg-demo-dev.solvapay.app'

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

const errors = []
const warnings = []

const dotEnvPath = resolve(exampleRoot, '.env.dev')
if (!existsSync(dotEnvPath)) {
  errors.push(
    `${dotEnvPath} missing — copy .env.dev.example to .env.dev and fill in dev values`,
  )
} else {
  const env = parseDotEnv(readFileSync(dotEnvPath, 'utf8'))

  for (const key of [
    'SOLVAPAY_SECRET_KEY',
    'SOLVAPAY_PRODUCT_REF',
    'MCP_PUBLIC_BASE_URL',
    'SOLVAPAY_API_BASE_URL',
  ]) {
    const value = env[key]?.trim()
    if (!value) {
      errors.push(`${key} is not set in .env.dev`)
      continue
    }
    if (PLACEHOLDER.test(value)) {
      errors.push(`${key} still has a placeholder value in .env.dev`)
    }
  }

  const secretKey = env.SOLVAPAY_SECRET_KEY ?? ''
  if (secretKey.startsWith('sk_live')) {
    const msg =
      'SOLVAPAY_SECRET_KEY looks like live — dev demo expects sk_test_… or sk_sandbox_… (see .env.dev.example)'
    if (allowLive) warnings.push(msg)
    else errors.push(`${msg}. Pass --allow-live to proceed anyway.`)
  }

  const publicUrl = env.MCP_PUBLIC_BASE_URL ?? ''
  if (publicUrl !== DEV_PUBLIC_URL) {
    errors.push(
      `MCP_PUBLIC_BASE_URL must be ${DEV_PUBLIC_URL} (got ${publicUrl || '(empty)'})`,
    )
  }

  const apiBaseUrl = env.SOLVAPAY_API_BASE_URL ?? ''
  if (!apiBaseUrl.includes('api-dev')) {
    errors.push(
      `SOLVAPAY_API_BASE_URL must point at api-dev (got ${apiBaseUrl || '(empty)'})`,
    )
  }
  if (apiBaseUrl.includes('api.solvapay.com') && !apiBaseUrl.includes('api-dev')) {
    errors.push('SOLVAPAY_API_BASE_URL must not point at production api.solvapay.com')
  }
}

const widgetHtml = resolve(exampleRoot, 'src/assets/mcp-app.html')
if (!existsSync(widgetHtml)) {
  errors.push(
    `${widgetHtml} missing — run \`pnpm build\` in examples/cloudflare-workers-mcp first`,
  )
}

const whoami = spawnSync('pnpm', ['exec', 'wrangler', 'whoami'], {
  cwd: exampleRoot,
  encoding: 'utf8',
})
if (whoami.status !== 0) {
  errors.push('wrangler is not authenticated — run `pnpm exec wrangler login`')
}

const secretList = spawnSync(
  'pnpm',
  ['exec', 'wrangler', 'secret', 'list', '--env', 'dev'],
  { cwd: exampleRoot, encoding: 'utf8' },
)
if (secretList.status !== 0) {
  errors.push('could not list dev Worker secrets — check Cloudflare access')
} else if (!/SOLVAPAY_SECRET_KEY/.test(secretList.stdout)) {
  errors.push(
    'SOLVAPAY_SECRET_KEY secret not found on solvapay-mcp-goldberg-dev — run once:\n' +
      '  pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env dev',
  )
}

console.log('Goldberg dev preflight\n')

if (warnings.length) {
  console.log('Warnings:')
  for (const w of warnings) console.log(`  ⚠  ${w}`)
  console.log('')
}

if (errors.length) {
  console.log('Blockers:')
  for (const e of errors) console.log(`  ✗  ${e}`)
  console.log('')
  console.log('Fix the blockers above, then run:')
  console.log('  pnpm preflight:dev && pnpm deploy:dev')
  process.exit(1)
}

console.log('Ready to deploy goldberg-demo dev.')
console.log('')
console.log('  pnpm deploy:dev')
console.log('')
console.log('Post-deploy (ChatGPT):')
console.log('  • Add a separate Custom Connector from prod — ChatGPT caches tools/list per connector')
console.log('  • MCP endpoint: https://goldberg-demo-dev.solvapay.app/mcp')
