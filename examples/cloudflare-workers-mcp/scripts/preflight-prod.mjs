#!/usr/bin/env node
/* global console, process */
/**
 * Pre-deploy checks for the goldberg-demo prod Worker
 * (`pnpm deploy:prod` -> solvapay-mcp-goldberg-prod).
 *
 * Validates `.env.prod`, build artifacts, and wrangler auth before
 * publishing to https://goldberg-demo.solvapay.app.
 *
 * Usage:
 *   node scripts/preflight-prod.mjs
 *   node scripts/preflight-prod.mjs --allow-sandbox   # warn only on sk_sandbox
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const exampleRoot = resolve(here, '..')
const allowSandbox = process.argv.includes('--allow-sandbox')

const PLACEHOLDER = /your_|replace_me|sk_test_your|sk_live_your|prd_your/i

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

const dotEnvPath = resolve(exampleRoot, '.env.prod')
if (!existsSync(dotEnvPath)) {
  errors.push(
    `${dotEnvPath} missing — copy .env.prod.example to .env.prod and fill in live values`,
  )
} else {
  const env = parseDotEnv(readFileSync(dotEnvPath, 'utf8'))

  for (const key of ['SOLVAPAY_SECRET_KEY', 'SOLVAPAY_PRODUCT_REF', 'MCP_PUBLIC_BASE_URL']) {
    const value = env[key]?.trim()
    if (!value) {
      errors.push(`${key} is not set in .env.prod`)
      continue
    }
    if (PLACEHOLDER.test(value)) {
      errors.push(`${key} still has a placeholder value in .env.prod`)
    }
  }

  const secretKey = env.SOLVAPAY_SECRET_KEY ?? ''
  if (secretKey.startsWith('sk_sandbox') || secretKey.startsWith('sk_test')) {
    const msg =
      'SOLVAPAY_SECRET_KEY looks like sandbox/test — prod demo expects sk_live_… (see .env.prod.example)'
    if (allowSandbox) warnings.push(msg)
    else errors.push(`${msg}. Pass --allow-sandbox to proceed anyway.`)
  }

  const publicUrl = env.MCP_PUBLIC_BASE_URL ?? ''
  if (publicUrl && publicUrl !== 'https://goldberg-demo.solvapay.app') {
    warnings.push(
      `MCP_PUBLIC_BASE_URL is ${publicUrl} — goldberg prod normally uses https://goldberg-demo.solvapay.app`,
    )
  }

  if (env.SOLVAPAY_API_BASE_URL?.includes('api-dev')) {
    warnings.push('SOLVAPAY_API_BASE_URL points at api-dev — omit it for production api.solvapay.com')
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
  ['exec', 'wrangler', 'secret', 'list', '--env', 'production'],
  { cwd: exampleRoot, encoding: 'utf8' },
)
if (secretList.status !== 0) {
  errors.push('could not list prod Worker secrets — check Cloudflare access')
} else if (!/SOLVAPAY_SECRET_KEY/.test(secretList.stdout)) {
  errors.push(
    'SOLVAPAY_SECRET_KEY secret not found on solvapay-mcp-goldberg-prod — run once:\n' +
      '  pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env production',
  )
}

console.log('Goldberg prod preflight\n')

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
  console.log('  pnpm preflight:prod && pnpm deploy:prod')
  process.exit(1)
}

console.log('Ready to deploy goldberg-demo prod.')
console.log('')
console.log('  pnpm deploy:prod')
console.log('')
console.log('Post-deploy (ChatGPT):')
console.log('  • Delete and re-add the Custom Connector so tools/list cache refreshes')
console.log('  • Verify topup: call topup → iframe → create_topup_payment_intent succeeds')
console.log('  • MCP endpoint: https://goldberg-demo.solvapay.app/mcp')
