import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  // @ts-expect-error — `scripts/mcp/lib/openapi.mjs` is a plain ESM module
  // with no .d.ts. These tests pin the small advisory surface consumed by
  // describe.mjs and scaffold.mjs.
  buildSpecShapeAdvisories,
} from '../../../scripts/mcp/lib/openapi.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

type Advisory = {
  kind: string
  message: string
  dominantPrefix?: string
  operations?: Array<{ operationId: string; method: string; path: string }>
  serverUrl?: string
  headerNames?: string[]
}

const op = (operationId: string, path: string, security: unknown[] = []) => ({
  operationId,
  method: 'GET',
  path,
  security,
})

describe('buildSpecShapeAdvisories', () => {
  it('surfaces empty and relative server URL advisories', () => {
    const empty = buildSpecShapeAdvisories({
      servers: [],
      operations: [],
      schemes: [],
    }) as Advisory[]
    expect(empty.map(advisory => advisory.kind)).toContain('emptyServers')
    expect(empty[0]?.message).toContain('upstreamBaseUrl')

    const relative = buildSpecShapeAdvisories({
      servers: ['/api/v2'],
      operations: [],
      schemes: [],
    }) as Advisory[]
    expect(relative).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'relativeServerUrl',
          serverUrl: '/api/v2',
        }),
      ]),
    )
  })

  it('catches near-miss path prefixes such as /api-v2 versus /api/v2', () => {
    const advisories = buildSpecShapeAdvisories({
      servers: ['https://api.example.com'],
      operations: [
        op('listPatients', '/api/v2/patients'),
        op('getPatient', '/api/v2/patients/{id}'),
        op('listClaims', '/api/v2/claims'),
        op('legacyPatients', '/api-v2/patients'),
      ],
      schemes: [],
    }) as Advisory[]

    expect(advisories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pathPrefixOutlier',
          dominantPrefix: '/api/v2',
          operations: [expect.objectContaining({ operationId: 'legacyPatients' })],
        }),
      ]),
    )
  })

  it('recommends apiKey-multi when an operation requires multiple header schemes', () => {
    const advisories = buildSpecShapeAdvisories({
      servers: ['https://api.example.com'],
      operations: [
        op('getWidget', '/api/widgets/{id}', [{ clientId: [], clientSecret: [] }]),
      ],
      schemes: [
        {
          name: 'clientId',
          kind: 'apiKey-header',
          supported: true,
          headerName: 'x-api-client-id',
        },
        {
          name: 'clientSecret',
          kind: 'apiKey-header',
          supported: true,
          headerName: 'x-api-client-secret',
        },
      ],
    }) as Advisory[]

    expect(advisories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'multiHeaderAuth',
          headerNames: ['x-api-client-id', 'x-api-client-secret'],
        }),
      ]),
    )
  })
})

describe('scaffold.mjs — upstreamBaseUrl', () => {
  it('fails instead of emitting upstream.example.com when generated tools need a base URL', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-upstream-base-'))
    try {
      const specPath = path.join(parent, 'no-server.spec.json')
      const selectionsPath = path.join(parent, 'selections.json')
      const target = path.join(parent, 'project')
      await writeFile(specPath, JSON.stringify(makeSpec()), 'utf8')
      await writeFile(selectionsPath, JSON.stringify(makeSelections()), 'utf8')

      const result = await spawnScript('scaffold.mjs', [specPath, target, '--selections', selectionsPath])

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('upstreamBaseUrl')
      expect(result.stderr).not.toContain('upstream.example.com')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('uses explicit upstreamBaseUrl for generated tool URLs', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-upstream-base-'))
    try {
      const specPath = path.join(parent, 'no-server.spec.json')
      const selectionsPath = path.join(parent, 'selections.json')
      const target = path.join(parent, 'project')
      await writeFile(specPath, JSON.stringify(makeSpec()), 'utf8')
      await writeFile(
        selectionsPath,
        JSON.stringify({
          ...makeSelections(),
          upstreamBaseUrl: 'https://api.health.example.com/v1',
        }),
        'utf8',
      )

      const result = await spawnScript('scaffold.mjs', [specPath, target, '--selections', selectionsPath])

      expect(result.exitCode, result.stderr).toBe(0)
      const tool = await readFile(path.join(target, 'src', 'tools', 'getStatus.ts'), 'utf8')
      expect(tool).toContain('https://api.health.example.com/v1/status')
      expect(tool).not.toContain('upstream.example.com')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

function makeSpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'No Server API', version: '1.0.0' },
    paths: {
      '/status': {
        get: {
          operationId: 'getStatus',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { ok: { type: 'boolean' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}

function makeSelections(): Record<string, unknown> {
  return {
    workerName: 'no-server-mcp',
    mcpPublicBaseUrl: 'http://localhost:8787',
    mode: 'one-to-one',
    upstreamAuth: { kind: 'none' },
    operations: [{ operationId: 'getStatus', tier: 'free' }],
  }
}

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
