/**
 * Unit + integration coverage for the `client-credentials-header` path —
 * a client-id + client-secret pair sent as two static request headers
 * (no token exchange; contrast `oauth2-client-credentials`).
 *
 * Four slices:
 *   1. `resolveSecuritySchemes` — the fixture's two apiKey-header schemes
 *      both resolve as supported `apiKey-header`.
 *   2. `detectClientCredentialsHeaderPair` — the CLI auto-detector
 *      disambiguates id vs secret by name and bails when it can't.
 *   3. `scaffold.mjs` validator — negative-path error messages.
 *   4. End-to-end scaffold — both headers land in the generated tool
 *      files, both UPSTREAM_CLIENT_* land in .env, and neither
 *      UPSTREAM_API_KEY nor the OAuth vars leak in.
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
import { detectClientCredentialsHeaderPair } from './from-openapi'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const CCH_SPEC = path.join(FIXTURES_DIR, 'client-credentials-header.spec.json')
const CCH_SELECTIONS = path.join(FIXTURES_DIR, 'client-credentials-header.selections.json')

type ResolvedScheme = {
  name: string
  supported: boolean
  kind: string
  headerName?: string
}

describe('resolveSecuritySchemes — client-credentials header pair', () => {
  it('resolves both apiKey header schemes as supported apiKey-header', () => {
    const spec = {
      components: {
        securitySchemes: {
          'acme-client-id': { type: 'apiKey', in: 'header', name: 'x-acme-client-id' },
          'acme-client-secret': { type: 'apiKey', in: 'header', name: 'x-acme-client-secret' },
        },
      },
    }
    const resolved = resolveSecuritySchemes(spec) as ResolvedScheme[]
    expect(resolved).toHaveLength(2)
    for (const scheme of resolved) {
      expect(scheme.supported).toBe(true)
      expect(scheme.kind).toBe('apiKey-header')
    }
    expect(resolved.map(s => s.headerName).sort()).toEqual([
      'x-acme-client-id',
      'x-acme-client-secret',
    ])
  })
})

describe('detectClientCredentialsHeaderPair', () => {
  const id = { supported: true, kind: 'apiKey-header', headerName: 'x-acme-client-id', name: 'acme-client-id' }
  const secret = {
    supported: true,
    kind: 'apiKey-header',
    headerName: 'x-acme-client-secret',
    name: 'acme-client-secret',
  }

  it('disambiguates id vs secret regardless of order', () => {
    expect(detectClientCredentialsHeaderPair([id, secret])).toEqual({
      idHeader: 'x-acme-client-id',
      secretHeader: 'x-acme-client-secret',
    })
    expect(detectClientCredentialsHeaderPair([secret, id])).toEqual({
      idHeader: 'x-acme-client-id',
      secretHeader: 'x-acme-client-secret',
    })
  })

  it('returns null when there are not exactly two header schemes', () => {
    expect(detectClientCredentialsHeaderPair([id])).toBeNull()
    expect(detectClientCredentialsHeaderPair([id, secret, secret])).toBeNull()
  })

  it('returns null when the pair cannot be disambiguated (no secret-looking scheme)', () => {
    const a = { supported: true, kind: 'apiKey-header', headerName: 'x-key-a', name: 'a' }
    const b = { supported: true, kind: 'apiKey-header', headerName: 'x-key-b', name: 'b' }
    expect(detectClientCredentialsHeaderPair([a, b])).toBeNull()
  })

  it('ignores non-header schemes and still detects the pair', () => {
    const bearer = { supported: true, kind: 'http-bearer', headerName: 'Authorization' }
    expect(detectClientCredentialsHeaderPair([id, secret, bearer])).toEqual({
      idHeader: 'x-acme-client-id',
      secretHeader: 'x-acme-client-secret',
    })
  })

  it('ignores unsupported header schemes when counting the pair', () => {
    const unsupported = { supported: false, kind: 'apiKey-header', headerName: 'x-legacy', name: 'legacy' }
    expect(detectClientCredentialsHeaderPair([id, secret, unsupported])).toEqual({
      idHeader: 'x-acme-client-id',
      secretHeader: 'x-acme-client-secret',
    })
  })
})

describe('scaffold.mjs — client-credentials-header validator', () => {
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

  it('rejects a missing clientSecret', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'client-credentials-header',
        clientId: { headerName: 'x-acme-client-id', value: 'a' },
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/clientSecret/)
  })

  it('rejects an empty headerName', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'client-credentials-header',
        clientId: { headerName: '', value: 'a' },
        clientSecret: { headerName: 'x-acme-client-secret', value: 'b' },
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/headerName/)
  })

  it('rejects an empty value', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'client-credentials-header',
        clientId: { headerName: 'x-acme-client-id', value: 'a' },
        clientSecret: { headerName: 'x-acme-client-secret', value: '' },
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/value/)
  })

  it('rejects identical header names for id and secret', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...base,
      upstreamAuth: {
        kind: 'client-credentials-header',
        clientId: { headerName: 'x-acme-token', value: 'a' },
        clientSecret: { headerName: 'x-acme-token', value: 'b' },
      },
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/must differ/)
  })

  async function runScaffoldWithSelections(
    selections: Record<string, unknown>,
  ): Promise<{ exitCode: number; stderr: string }> {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-cch-neg-'))
    cleanup.push(parent)
    const selectionsPath = path.join(parent, 'selections.json')
    await writeFile(selectionsPath, JSON.stringify(selections), 'utf8')
    const target = path.join(parent, 'project')
    const result = await spawnScript('scaffold.mjs', [
      CCH_SPEC,
      target,
      '--selections',
      selectionsPath,
    ])
    return { exitCode: result.exitCode, stderr: result.stderr }
  }
})

describe('scaffold.mjs — end-to-end client-credentials-header', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('emits both headers in tool files and writes UPSTREAM_CLIENT_* to .env', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-cch-smoke-'))
    cleanup.push(parent)
    const target = path.join(parent, 'acme-widgets-mcp')

    const result = await spawnScript('scaffold.mjs', [
      CCH_SPEC,
      target,
      '--selections',
      CCH_SELECTIONS,
    ])
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
    expect(seededNames).toEqual(
      expect.arrayContaining(['UPSTREAM_CLIENT_ID', 'UPSTREAM_CLIENT_SECRET']),
    )
    expect(seededNames).not.toContain('UPSTREAM_API_KEY')

    const paidTool = await readFile(path.join(target, 'src', 'tools', 'createWidget.ts'), 'utf8')
    expect(paidTool).toContain("'x-acme-client-id': `${env.UPSTREAM_CLIENT_ID}`")
    expect(paidTool).toContain("'x-acme-client-secret': `${env.UPSTREAM_CLIENT_SECRET}`")
    expect(paidTool).toContain("import type { Env } from '../worker'")
    expect(paidTool).toContain("ctx.registerPayable('createWidget'")
    expect(paidTool).not.toContain('getAccessToken')

    const freeTool = await readFile(path.join(target, 'src', 'tools', 'getWidget.ts'), 'utf8')
    expect(freeTool).toContain("'x-acme-client-id': `${env.UPSTREAM_CLIENT_ID}`")
    expect(freeTool).toContain("'x-acme-client-secret': `${env.UPSTREAM_CLIENT_SECRET}`")
    expect(freeTool).toContain('ctx.server.registerTool(')

    const env = await readFile(path.join(target, '.env'), 'utf8')
    expect(env).toMatch(/^UPSTREAM_CLIENT_ID=smoke-client-id$/m)
    expect(env).toMatch(/^UPSTREAM_CLIENT_SECRET=smoke-client-secret$/m)
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
