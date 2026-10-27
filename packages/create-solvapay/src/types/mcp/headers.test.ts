/**
 * `in: header` parameters in one-to-one tools. They were exposed as tool
 * inputs but never sent. Now they go out as request headers, except the
 * ones OpenAPI says to ignore (Accept, Content-Type, Authorization) and any
 * that name the upstream credential header, which would let the LLM supply
 * or overwrite the secret.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const SPEC = path.join(FIXTURES_DIR, 'headers.spec.json')
const SELECTIONS = path.join(FIXTURES_DIR, 'headers.selections.json')

describe('scaffold.mjs — header parameters', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('sends header params, drops reserved ones, and keeps the credential header authoritative', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-headers-'))
    cleanup.push(parent)
    const target = path.join(parent, 'headers-smoke')

    const result = await spawnScript('scaffold.mjs', [SPEC, target, '--selections', SELECTIONS])
    expect(result.exitCode, `scaffold.mjs failed:\n--stderr--\n${result.stderr}`).toBe(0)

    const tool = await readFile(path.join(target, 'src', 'tools', 'getReport.ts'), 'utf8')

    // Inputs: the two real header params stay; Accept and the credential header go.
    expect(tool).toContain('"X-Request-Id": z.string().describe("Trace ID").optional(),')
    expect(tool).toContain('"If-Match": z.string(),')
    expect(tool).not.toMatch(/\bAccept\b.*z\./)
    expect(tool).not.toContain('"X-Api-Key": z.')

    // Non-identifier names use bracket access (was `input.["page-size"]`, a syntax error).
    expect(tool).toContain(
      "if (input[\"page-size\"] !== undefined) url.searchParams.set('page-size', String(input[\"page-size\"]))",
    )

    // Headers: params first, then the credential, so the secret always wins.
    expect(tool).toContain(
      "headers: { ...(input[\"X-Request-Id\"] !== undefined ? { \"x-request-id\": String(input[\"X-Request-Id\"]) } : {}), " +
        "...(input[\"If-Match\"] !== undefined ? { \"if-match\": String(input[\"If-Match\"]) } : {}), " +
        "'x-api-key': `${env.UPSTREAM_API_KEY}` },",
    )
  })
})

async function spawnScript(
  scriptName: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, scriptName), ...args], {
      cwd: SCRIPTS_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', code => {
      resolve({ exitCode: code ?? -1, stdout, stderr })
    })
  })
}
