/**
 * Unit + integration coverage for the OAuth 2.0 client_credentials path
 * in `scripts/mcp/`.
 *
 * Three slices:
 *   1. `resolveSecuritySchemes` — direct import of the .mjs lib, fed
 *      hand-built scheme objects covering OpenAPI 3.x + Swagger 2.0
 *      shapes and the unsupported-flow fallback.
 *   2. `scaffold.mjs` validator — spawned with hand-crafted selections
 *      to exercise the negative-path error messages.
 *   3. End-to-end scaffold — runs the script against the OAuth fixture
 *      spec and snapshots the salient pieces of the generated tool file
 *      (imports, token pre-call, Bearer header) and the resulting .env.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveSecuritySchemes,
  isSupportedAuthKind,
  // @ts-expect-error — `scripts/mcp/lib/openapi.mjs` is a plain ESM module
  // with no .d.ts. The shape we consume is small and pinned by the tests
  // below, so the cast on the import is the cheapest way to keep the rest
  // of this file type-checked.
} from '../../../scripts/mcp/lib/openapi.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const OAUTH_SPEC = path.join(FIXTURES_DIR, 'oauth-cc.spec.json')
const OAUTH_SELECTIONS = path.join(FIXTURES_DIR, 'oauth-cc.selections.json')

type ResolvedScheme = {
  name: string
  type?: string
  supported: boolean
  kind: string
  tokenUrl?: string
  scopes?: Record<string, string>
  flow?: string
  reason?: string
}

describe('resolveSecuritySchemes — oauth2 client_credentials', () => {
  it('OpenAPI 3 flows.clientCredentials → supported with tokenUrl + scopes', () => {
    const spec = {
      components: {
        securitySchemes: {
          oauthCc: {
            type: 'oauth2',
            flows: {
              clientCredentials: {
                tokenUrl: 'https://api.example.test/token',
                scopes: { 'company:read': 'Read company records' },
              },
            },
          },
        },
      },
    }
    const resolved = resolveSecuritySchemes(spec) as ResolvedScheme[]
    expect(resolved).toHaveLength(1)
    const [scheme] = resolved
    expect(scheme).toMatchObject({
      name: 'oauthCc',
      supported: true,
      kind: 'oauth2-clientCredentials',
      tokenUrl: 'https://api.example.test/token',
      flow: 'clientCredentials',
    })
    expect(scheme.scopes).toEqual({ 'company:read': 'Read company records' })
    expect(isSupportedAuthKind('oauth2-clientCredentials')).toBe(true)
  })

  it('Swagger 2.0 flow: application → supported (v2 spelling of clientCredentials)', () => {
    const spec = {
      securityDefinitions: {
        oauthCcV2: {
          type: 'oauth2',
          flow: 'application',
          tokenUrl: 'https://api.example.test/oauth/token',
          scopes: { read: 'Read access' },
        },
      },
    }
    const resolved = resolveSecuritySchemes(spec) as ResolvedScheme[]
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({
      supported: true,
      kind: 'oauth2-clientCredentials',
      tokenUrl: 'https://api.example.test/oauth/token',
    })
  })

  it('oauth2 with only authorizationCode flow → unsupported with reasoned advisory', () => {
    const spec = {
      components: {
        securitySchemes: {
          oauthAc: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://example.test/authorize',
                tokenUrl: 'https://example.test/token',
                scopes: {},
              },
            },
          },
        },
      },
    }
    const [scheme] = resolveSecuritySchemes(spec) as ResolvedScheme[]
    expect(scheme.supported).toBe(false)
    expect(scheme.kind).toBe('oauth2')
    expect(scheme.reason).toMatch(/clientCredentials/)
  })

  it('oauth2 with clientCredentials AND another flow → still surfaces clientCredentials as supported', () => {
    const spec = {
      components: {
        securitySchemes: {
          mixed: {
            type: 'oauth2',
            flows: {
              clientCredentials: {
                tokenUrl: 'https://example.test/token',
                scopes: {},
              },
              authorizationCode: {
                authorizationUrl: 'https://example.test/authorize',
                tokenUrl: 'https://example.test/token',
                scopes: {},
              },
            },
          },
        },
      },
    }
    const [scheme] = resolveSecuritySchemes(spec) as ResolvedScheme[]
    expect(scheme.supported).toBe(true)
    expect(scheme.kind).toBe('oauth2-clientCredentials')
  })
})

describe('scaffold.mjs — oauth2-client-credentials validator', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('rejects missing tokenUrl', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      workerName: 'bad',
      mcpPublicBaseUrl: 'http://localhost:8787',
      upstreamAuth: {
        kind: 'oauth2-client-credentials',
        clientId: 'a',
        clientSecret: 'b',
      },
      mode: 'one-to-one',
      operations: [],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/tokenUrl.*required/i)
  })

  it('rejects non-https tokenUrl that is not localhost', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      workerName: 'bad',
      mcpPublicBaseUrl: 'http://localhost:8787',
      upstreamAuth: {
        kind: 'oauth2-client-credentials',
        tokenUrl: 'http://example.test/token',
        clientId: 'a',
        clientSecret: 'b',
      },
      mode: 'one-to-one',
      operations: [],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/https:\/\//)
  })

  it('rejects missing clientSecret', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      workerName: 'bad',
      mcpPublicBaseUrl: 'http://localhost:8787',
      upstreamAuth: {
        kind: 'oauth2-client-credentials',
        tokenUrl: 'https://example.test/token',
        clientId: 'a',
      },
      mode: 'one-to-one',
      operations: [],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/clientSecret/)
  })

  it('rejects malformed tokenUrl', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      workerName: 'bad',
      mcpPublicBaseUrl: 'http://localhost:8787',
      upstreamAuth: {
        kind: 'oauth2-client-credentials',
        tokenUrl: 'not-a-url',
        clientId: 'a',
        clientSecret: 'b',
      },
      mode: 'one-to-one',
      operations: [],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/valid URL/)
  })

  async function runScaffoldWithSelections(
    selections: Record<string, unknown>,
  ): Promise<{ exitCode: number; stderr: string }> {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-oauth-neg-'))
    cleanup.push(parent)
    const selectionsPath = path.join(parent, 'selections.json')
    await writeFile(selectionsPath, JSON.stringify(selections), 'utf8')
    const target = path.join(parent, 'project')
    const result = await spawnScript('scaffold.mjs', [
      OAUTH_SPEC,
      target,
      '--selections',
      selectionsPath,
    ])
    return { exitCode: result.exitCode, stderr: result.stderr }
  }
})

describe('scaffold.mjs — end-to-end oauth2-client-credentials', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('emits a tool file with getAccessToken + Bearer header and writes UPSTREAM_OAUTH_* to .env', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-oauth-smoke-'))
    cleanup.push(parent)
    const target = path.join(parent, 'oauth-cc-smoke')

    const result = await spawnScript('scaffold.mjs', [
      OAUTH_SPEC,
      target,
      '--selections',
      OAUTH_SELECTIONS,
    ])
    expect(result.exitCode, `scaffold.mjs failed:\n--stderr--\n${result.stderr}`).toBe(0)
    const summary = JSON.parse(result.stdout) as {
      mode: string
      operationsGenerated: Array<{ operationId: string; tier: string }>
      secretsSeeded: Array<{ name: string }>
    }
    expect(summary.mode).toBe('one-to-one')
    expect(summary.operationsGenerated.map(o => o.operationId).sort()).toEqual([
      'addCompanyNote',
      'getCompany',
    ])
    const seededNames = summary.secretsSeeded.map(s => s.name)
    expect(seededNames).toEqual(
      expect.arrayContaining([
        'UPSTREAM_OAUTH_TOKEN_URL',
        'UPSTREAM_OAUTH_CLIENT_ID',
        'UPSTREAM_OAUTH_CLIENT_SECRET',
        'UPSTREAM_OAUTH_SCOPE',
      ]),
    )
    expect(seededNames).not.toContain('UPSTREAM_API_KEY')

    const paidTool = await readFile(path.join(target, 'src', 'tools', 'addCompanyNote.ts'), 'utf8')
    expect(paidTool).toContain("import { getAccessToken } from '../lib/upstreamOAuth'")
    expect(paidTool).toContain('const token = await getAccessToken(env)')
    expect(paidTool).toContain('authorization: `Bearer ${token}`')
    expect(paidTool).toContain("ctx.registerPayable('addCompanyNote'")

    const freeTool = await readFile(path.join(target, 'src', 'tools', 'getCompany.ts'), 'utf8')
    expect(freeTool).toContain('const token = await getAccessToken(env)')
    expect(freeTool).toContain('authorization: `Bearer ${token}`')
    expect(freeTool).toContain('ctx.server.registerTool(')

    const env = await readFile(path.join(target, '.env'), 'utf8')
    expect(env).toMatch(/^UPSTREAM_OAUTH_TOKEN_URL=https:\/\/api\.example-roaring\.test\/token$/m)
    expect(env).toMatch(/^UPSTREAM_OAUTH_CLIENT_ID=smoke-client-id$/m)
    expect(env).toMatch(/^UPSTREAM_OAUTH_CLIENT_SECRET=smoke-client-secret$/m)
    expect(env).toMatch(/^UPSTREAM_OAUTH_SCOPE=company:read company:write$/m)
    expect(env).not.toMatch(/^UPSTREAM_API_KEY=/m)
    expect(env).not.toMatch(/^UPSTREAM_OAUTH_AUDIENCE=/m)

    // upstreamOAuth.ts ships from _base, untouched by overlay.
    const helper = await readFile(path.join(target, 'src', 'lib', 'upstreamOAuth.ts'), 'utf8')
    expect(helper).toContain('export async function getAccessToken')
    expect(helper).toContain("grant_type: 'client_credentials'")
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
