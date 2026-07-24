/**
 * Spawn rust/tools/shadow-invoker for one operation (stdin/stdout JSON).
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SideOutcome, WireExchange } from './compare.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUST_DIR = path.join(REPO_ROOT, 'rust')
const DEFAULT_DEBUG_BIN = path.join(RUST_DIR, 'target/debug/shadow-invoker')

export type RustInvokerRequest = {
  fn: string
  argsJson: Record<string, unknown>
  baseUrl: string
  apiKey: string
}

type InvokerResponse = {
  ok: boolean
  value?: unknown
  error?: unknown
  wire?: WireExchange[]
}

function cargoTargetDebugBin(): string | undefined {
  const targetDir = process.env.CARGO_TARGET_DIR
  if (!targetDir) return undefined
  return path.join(targetDir, 'debug', 'shadow-invoker')
}

/** Pick the newest existing invoker binary across CARGO_TARGET_DIR and workspace target. */
function resolveInvokerBin(explicit?: string): { command: string; args: string[] } {
  if (explicit) {
    return { command: explicit, args: [] }
  }
  if (process.env.SHADOW_INVOKER_BIN) {
    return { command: process.env.SHADOW_INVOKER_BIN, args: [] }
  }
  const candidates = [cargoTargetDebugBin(), DEFAULT_DEBUG_BIN].filter(
    (p): p is string => typeof p === 'string' && existsSync(p),
  )
  let best: { path: string; mtime: number } | undefined
  for (const candidate of candidates) {
    const mtime = statSync(candidate).mtimeMs
    if (!best || mtime > best.mtime) {
      best = { path: candidate, mtime }
    }
  }
  if (best) {
    return { command: best.path, args: [] }
  }
  return { command: 'cargo', args: ['run', '-q', '-p', 'shadow-invoker'] }
}

/**
 * Invoke one Rust client method via `shadow-invoker` (prebuilt bin or cargo run).
 *
 * Uses spawn (not exec) and accumulates stdout until close so large JSON
 * responses are not truncated by maxBuffer.
 */
export async function invokeRustShadow(
  request: RustInvokerRequest,
  options: { binPath?: string } = {},
): Promise<SideOutcome> {
  const payload = JSON.stringify({
    fn: request.fn,
    argsJson: request.argsJson,
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
  })

  const { command, args } = resolveInvokerBin(options.binPath)
  const { stdout, stderr, code } = await runProcess(command, args, payload, RUST_DIR)

  if (code !== 0) {
    return {
      ok: false,
      value: {
        name: 'SolvaPayError',
        message: stderr.trim() || `shadow-invoker exited with code ${code}`,
        kind: 'Transport',
        code: 'non_retryable',
      },
      wire: [],
    }
  }

  let parsed: InvokerResponse
  try {
    parsed = JSON.parse(stdout.trim()) as InvokerResponse
  } catch (error) {
    return {
      ok: false,
      value: {
        name: 'SolvaPayError',
        message: `invalid shadow-invoker JSON: ${String(error)}; stdout=${stdout.slice(0, 200)}`,
        kind: 'Transport',
        code: 'non_retryable',
      },
      wire: [],
    }
  }

  if (parsed.ok) {
    return {
      ok: true,
      value: parsed.value ?? null,
      wire: parsed.wire ?? [],
    }
  }
  return {
    ok: false,
    value: parsed.error ?? { message: 'unknown rust error', kind: 'Transport' },
    wire: parsed.wire ?? [],
  }
}

function runProcess(
  command: string,
  args: string[],
  stdinPayload: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => {
      resolve({ stdout, stderr, code })
    })
    child.stdin.write(stdinPayload)
    child.stdin.end()
  })
}
