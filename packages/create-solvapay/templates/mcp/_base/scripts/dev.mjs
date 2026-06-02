#!/usr/bin/env node
/* global console, process */
/**
 * `npm run dev` — single command that starts everything you need
 * to develop a paid MCP server locally:
 *
 *   1. `vite build --watch` — rebuilds `src/assets/mcp-app.html` whenever
 *      the React widget source changes. Required because `worker.ts`
 *      imports the built HTML as a text asset; without the watch step,
 *      changes to `mcp-app.tsx` would not show up in `wrangler dev`.
 *   2. `wrangler dev` — Workers runtime on http://localhost:8787,
 *      reads `.env` for `SOLVAPAY_SECRET_KEY` / `SOLVAPAY_PRODUCT_REF` /
 *      `MCP_PUBLIC_BASE_URL` / `UPSTREAM_API_KEY` / `UPSTREAM_API_HEADERS`.
 *
 * Output is interleaved with `[vite]` / `[wrangler]` tags so the two
 * processes are easy to tell apart. Ctrl+C tears both down.
 *
 * Run with `--no-banner` to suppress the URL banner (e.g. from CI).
 */

import { spawn } from 'node:child_process'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { watch } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

const NO_BANNER = process.argv.includes('--no-banner')
const WORKER_URL = 'http://localhost:8787'
const VITE_OUT = 'dist/mcp-app.html'
const WORKER_INPUT = 'src/assets/mcp-app.html'

function printBanner() {
  if (NO_BANNER) return
  const lines = [
    '',
    '┌─ SolvaPay MCP — local dev ─────────────────────────────────',
    `│  Worker MCP endpoint  ${WORKER_URL}/`,
    `│  OAuth discovery       ${WORKER_URL}/.well-known/oauth-protected-resource`,
    `│  OAuth metadata        ${WORKER_URL}/.well-known/oauth-authorization-server`,
    '│',
    '│  Inspect tools         npx @modelcontextprotocol/inspector',
    `│                        (set the server URL to ${WORKER_URL}/)`,
    '│',
    '│  Verify contract       node scripts/verify.mjs ' + WORKER_URL,
    '└────────────────────────────────────────────────────────────',
    '',
  ]
  process.stdout.write(lines.join('\n'))
}

function tag(name, color) {
  const reset = '\x1b[0m'
  return (chunk) => {
    const text = chunk.toString('utf8')
    const lines = text.split(/\r?\n/)
    if (lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      process.stdout.write(`${color}[${name}]${reset} ${line}\n`)
    }
  }
}

function start(name, command, args, color, extraEnv) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, ...(extraEnv ?? {}) },
  })
  child.stdout.on('data', tag(name, color))
  child.stderr.on('data', tag(name, color))
  child.once('exit', (code, signal) => {
    if (signal) {
      process.stdout.write(`[${name}] exited via ${signal}\n`)
    } else {
      process.stdout.write(`[${name}] exited with code ${code ?? 0}\n`)
    }
    shutdown(code ?? 0)
  })
  return child
}

let shuttingDown = false
const children = []

function shutdown(exitCode) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore — process may already be gone
      }
    }
  }
  setTimeout(() => process.exit(exitCode), 250)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

printBanner()

const vite = start(
  'vite',
  'npx',
  ['vite', 'build', '--watch'],
  '\x1b[36m', // cyan
  { INPUT: 'mcp-app.html' },
)
const wrangler = start(
  'wrangler',
  'npx',
  ['wrangler', 'dev'],
  '\x1b[35m', // magenta
)
children.push(vite, wrangler)

// Mirror dist/mcp-app.html into src/assets/mcp-app.html on every vite
// rebuild. `worker.ts` imports the asset from src/assets/, and wrangler
// dev re-bundles when files under src/ change — so the copy here is
// what propagates widget edits into the running worker.
async function mirrorAsset() {
  try {
    await mkdir(dirname(WORKER_INPUT), { recursive: true })
    await copyFile(VITE_OUT, WORKER_INPUT)
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      process.stdout.write(`[dev] mirror failed: ${err.message}\n`)
    }
  }
}

async function watchVite() {
  // Wait for the file to exist before watching; the initial build
  // produces it but vite's `--watch` may race the first stat.
  for (let i = 0; i < 40; i++) {
    try {
      await stat(VITE_OUT)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  await mirrorAsset()
  const watcher = watch(VITE_OUT, async (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      await mirrorAsset()
    }
  })
  watcher.on('error', () => {
    // Best-effort; vite watcher restarts on its own.
  })
}

watchVite().catch(() => {
  // non-fatal; widget changes won't auto-reflect but wrangler stays up.
})

// Re-print the banner once after a short delay so it isn't lost in
// the initial build burst. `wrangler dev` doesn't print its own
// ready-state line we can reliably hook into here.
if (!NO_BANNER) {
  setTimeout(() => {
    process.stdout.write('\n')
    printBanner()
  }, 4000)
}
