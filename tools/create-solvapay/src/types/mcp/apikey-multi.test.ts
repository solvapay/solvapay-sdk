/**
 * Unit + integration coverage for the `apiKey-multi` path — two or more
 * static credential headers required together (the OpenAPI "multiple
 * required schemes" case; no token exchange). Deliberately generic over
 * N headers and header names (AppKey/AppToken here, not client-id/secret).
 *
 * Four slices:
 *   1. `resolveSecuritySchemes` — the fixture's two apiKey-header schemes
 *      both resolve as supported `apiKey-header`.
 *   2. `detectApiKeyMultiHeaders` — the CLI auto-detector returns all
 *      header names (incl. a triple), dedupes, and bails below two.
 *   3. `scaffold.mjs` validator — negative-path error messages.
 *   4. End-to-end scaffold — the spread lands in the generated tool files,
 *      a single compact-JSON UPSTREAM_API_HEADERS lands in .env, and
 *      neither UPSTREAM_API_KEY nor the OAuth vars leak in.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveSecuritySchemes,
  // @ts-expect-error — `scripts/mcp/lib/openapi.mjs` is a plain ESM module
  // with no .d.ts. The shape we consume is small and pinned by the tests
  // below, so the cast on the import is the cheapest way to keep the rest
  // of this file type-checked.
} from '../../../scripts/mcp/lib/openapi.mjs'
import { detectApiKeyMultiHeaders } from './from-openapi'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const SPEC = path.join(FIXTURES_DIR, 'apikey-multi.spec.json')
const SELECTIONS = path.join(FIXTURES_DIR, 'apikey-multi.selections.json')

type ResolvedScheme = {
  name: string
  supported: boolean
  kind: string
  headerName?: string
}

describe('resolveSecuritySchemes — multiple apiKey header schemes', () => {
  it('resolves both apiKey header schemes as supported apiKey-header', () => {
    const spec = {
      components: {
        securitySchemes: {
          'acme-app-key': { type: 'apiKey', in: 'header', name: 'x-acme-app-key' },
          'acme-app-token': { type: 'apiKey', in: 'header', name: 'x-acme-app-token' },
        },
      },
    }
    const resolved = resolveSecuritySchemes(spec) as ResolvedScheme[]
    expect(resolved).toHaveLength(2)
    for (const scheme of resolved) {
      expect(scheme.supported).toBe(true)
      expect(scheme.kind).toBe('apiKey-header')
    }
    expect(resolved.map(s => s.headerName).sort()).toEqual(['x-acme-app-key', 'x-acme-app-token'])
  })
})

describe('detectApiKeyMultiHeaders', () => {
  const appKey = { supported: true, kind: 'apiKey-header', headerName: 'x-acme-app-key' }
  const appToken = { supported: true, kind: 'apiKey-header', headerName: 'x-acme-app-token' }

  it('returns all header names in declared order for a pair', () => {
    expect(detectApiKeyMultiHeaders([appKey, appToken])).toEqual([
      'x-acme-app-key',
      'x-acme-app-token',
    ])
  })

  it('handles three-or-more headers (e.g. Apideck-style triple)', () => {
    const third = { supported: true, kind: 'apiKey-header', headerName: 'x-consumer-id' }
    expect(detectApiKeyMultiHeaders([appKey, appToken, third])).toEqual([
      'x-acme-app-key',
      'x-acme-app-token',
      'x-consumer-id',
    ])
  })

  it('returns null with fewer than two header schemes', () => {
    expect(detectApiKeyMultiHeaders([appKey])).toBeNull()
    expect(detectApiKeyMultiHeaders([])).toBeNull()
  })

  it('ignores non-header and unsupported schemes', () => {
    const bearer = { supported: true, kind: 'http-bearer', headerName: 'Authorization' }
    const unsupported = { supported: false, kind: 'apiKey-header', headerName: 'x-legacy' }
    expect(detectApiKeyMultiHeaders([appKey, bearer, unsupported])).toBeNull()
    expect(detectApiKeyMultiHeaders([appKey, appToken, bearer, unsupported])).toEqual([
      'x-acme-app-key',
      'x-acme-app-token',
    ])
  })

  it('dedupes repeated header names case-insensitively', () => {
    const dup = { supported: true, kind: 'apiKey-header', headerName: 'X-ACME-APP-KEY' }
    expect(detectApiKeyMultiHeaders([appKey, dup])).toBeNull()
  })
})

describe('scaffold.mjs — apiKey-multi validator', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  const base = {
    workerName: 'bad',
    mcpPublicBaseUrl: 'http://localhost:8787',
    mode: 'one-to-one' as const,
    operations: [],
  }

  it('rejects fewer than two headers', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: { kind: 'apiKey-multi', headers: [{ name: 'x-acme-app-key', value: 'a' }] },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/at least two/i)
  })

  it('rejects an empty header name', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'apiKey-multi',
        headers: [
          { name: '', value: 'a' },
          { name: 'x-acme-app-token', value: 'b' },
        ],
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/name/)
  })

  it('rejects an empty value', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'apiKey-multi',
        headers: [
          { name: 'x-acme-app-key', value: 'a' },
          { name: 'x-acme-app-token', value: '' },
        ],
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/value/)
  })

  it('rejects duplicate header names', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'apiKey-multi',
        headers: [
          { name: 'x-acme-token', value: 'a' },
          { name: 'X-ACME-TOKEN', value: 'b' },
        ],
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/duplicate header/i)
  })

  async function runScaffoldWithSelections(
    selections: Record<string, unknown>,
  ): Promise<{ exitCode: number; stderr: string }> {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-akm-neg-'))
    cleanup.push(parent)
    const selectionsPath = path.join(parent, 'selections.json')
    await writeFile(selectionsPath, JSON.stringify(selections), 'utf8')
    const target = path.join(parent, 'project')
    const result = await spawnScript('scaffold.mjs', [SPEC, target, '--selections', selectionsPath])
    return { exitCode: result.exitCode, stderr: result.stderr }
  }
})

describe('scaffold.mjs — end-to-end apiKey-multi', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('spreads UPSTREAM_API_HEADERS in tool files and writes one compact-JSON var to .env', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-akm-smoke-'))
    cleanup.push(parent)
    const target = path.join(parent, 'acme-widgets-mcp')

    const result = await spawnScript('scaffold.mjs', [SPEC, target, '--selections', SELECTIONS])
    expect(result.exitCode, `scaffold.mjs failed:\n--stderr--\n${result.stderr}`).toBe(0)

    const summary = JSON.parse(result.stdout) as {
      mode: string
      operationsGenerated: Array<{ operationId: string; tier: string }>
      secretsSeeded: Array<{ name: string }>
    }
    expect(summary.mode).toBe('one-to-one')
    expect(summary.operationsGenerated.map(o => o.operationId).sort()).toEqual([
      'createWidget',
      'getWidget',
    ])
    const seededNames = summary.secretsSeeded.map(s => s.name)
    expect(seededNames).toContain('UPSTREAM_API_HEADERS')
    expect(seededNames).not.toContain('UPSTREAM_API_KEY')

    const spread = "...(JSON.parse(env.UPSTREAM_API_HEADERS ?? '{}') as Record<string, string>)"
    const paidTool = await readFile(path.join(target, 'src', 'tools', 'createWidget.ts'), 'utf8')
    expect(paidTool).toContain(spread)
    expect(paidTool).toContain("import type { Env } from '../worker'")
    expect(paidTool).toContain("ctx.registerPayable('createWidget'")
    expect(paidTool).not.toContain('getAccessToken')

    const freeTool = await readFile(path.join(target, 'src', 'tools', 'getWidget.ts'), 'utf8')
    expect(freeTool).toContain(spread)
    expect(freeTool).toContain('ctx.server.registerTool(')

    const env = await readFile(path.join(target, '.env'), 'utf8')
    expect(env).toMatch(
      /^UPSTREAM_API_HEADERS=\{"x-acme-app-key":"smoke-app-key","x-acme-app-token":"smoke-app-token"\}$/m,
    )
    expect(env).not.toMatch(/^UPSTREAM_API_KEY=/m)
    expect(env).not.toMatch(/^UPSTREAM_OAUTH_/m)
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
