/**
 * Smoke tests for `describe.mjs` + `scaffold.mjs`.
 *
 * Drives the two `.mjs` CLIs (which have no exports) by spawning them
 * against three committed OpenAPI fixtures: Petstore v2 (Swagger 2.0),
 * Petstore v3 (OpenAPI 3.0.4), PokeAPI (OpenAPI 3.1). The fixtures live
 * in `__fixtures__/` and are refreshed via `scripts/refresh-smoke-fixtures.mjs`
 * — they intentionally drift from upstream so a Petstore release surfaces
 * as a failing assertion rather than a silent behaviour change.
 *
 * Set `SOLVAPAY_SMOKE_LIVE=1` to flip describe runs into probe mode and
 * verify each spec's `servers[0]` URL is reachable (nightly / manual).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const FIXTURE_PATHS = {
  petstoreV2: path.join(FIXTURES_DIR, 'petstore-v2.spec.json'),
  petstoreV3: path.join(FIXTURES_DIR, 'petstore-v3.spec.json'),
  pokeapi: path.join(FIXTURES_DIR, 'pokeapi.spec.yml'),
  apiKeyMulti: path.join(FIXTURES_DIR, 'apikey-multi.spec.json'),
} as const

const PETSTORE_V2_SELECTIONS = path.join(FIXTURES_DIR, 'petstore-v2.selections.json')

const LIVE_MODE = process.env.SOLVAPAY_SMOKE_LIVE === '1'

type DescribeOutput = {
  openapiVersion: string | null
  operations: Array<{ operationId: string; method: string }>
  securitySchemes: Array<{ name: string; supported: boolean; type?: string }>
  advisories: Array<{ kind: string }>
  serverProbe: { status: string }
}

type ScaffoldOutput = {
  mode: string
  operationsGenerated: Array<{ operationId: string; tier: string }>
  filesWritten: string[]
}

async function spawnScriptJson(scriptName: string, args: string[]): Promise<unknown> {
  const result = await spawnScript(scriptName, args)
  if (result.exitCode !== 0) {
    throw new Error(
      `${scriptName} exited with code ${result.exitCode}:\n--stderr--\n${result.stderr}`,
    )
  }
  try {
    return JSON.parse(result.stdout) as unknown
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    throw new Error(
      `${scriptName} produced non-JSON output: ${message}\n--stdout--\n${result.stdout.slice(0, 500)}`,
    )
  }
}

async function spawnScript(
  scriptName: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  return runCommand(process.execPath, [scriptPath, ...args], SCRIPTS_DIR)
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // `shell: true` on Windows lets us resolve `.cmd` shims (npm, npx) the
      // same way they're invoked from a normal shell.
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

describe('describe.mjs against cached fixtures', () => {
  it('petstore v2: 20 operations + surfaced securityDefinitions', async () => {
    const out = (await spawnScriptJson('describe.mjs', [
      FIXTURE_PATHS.petstoreV2,
      '--no-probe',
    ])) as DescribeOutput

    expect(out.openapiVersion).toBe('2.0')
    expect(out.operations).toHaveLength(20)

    const apiKey = out.securitySchemes.find(s => s.name === 'api_key')
    const petstoreAuth = out.securitySchemes.find(s => s.name === 'petstore_auth')
    expect(apiKey).toMatchObject({ supported: true })
    expect(petstoreAuth).toMatchObject({ supported: false })

    // oauth2-on-mutating-ops produces one advisory per offending operation.
    expect(out.advisories.some(a => a.kind === 'unsupported-auth')).toBe(true)
  })

  it('petstore v3: 19 operations + same security shape as v2', async () => {
    const out = (await spawnScriptJson('describe.mjs', [
      FIXTURE_PATHS.petstoreV3,
      '--no-probe',
    ])) as DescribeOutput

    expect(out.openapiVersion).toBe('3.0.4')
    expect(out.operations).toHaveLength(19)

    const apiKey = out.securitySchemes.find(s => s.name === 'api_key')
    const petstoreAuth = out.securitySchemes.find(s => s.name === 'petstore_auth')
    expect(apiKey).toMatchObject({ supported: true })
    expect(petstoreAuth).toMatchObject({ supported: false })
    expect(out.advisories.some(a => a.kind === 'unsupported-auth')).toBe(true)
  })

  it('pokeapi: 90+ GET-only operations + basicAuth flagged unsupported', async () => {
    const out = (await spawnScriptJson('describe.mjs', [
      FIXTURE_PATHS.pokeapi,
      '--no-probe',
    ])) as DescribeOutput

    expect(out.openapiVersion?.startsWith('3.1')).toBe(true)
    // PokeAPI ships ~98 operations today; the floor leaves headroom for
    // upstream additions without making the test brittle.
    expect(out.operations.length).toBeGreaterThan(90)
    expect(out.operations.every(op => op.method === 'GET')).toBe(true)

    const basicAuth = out.securitySchemes.find(s => s.name === 'basicAuth')
    expect(basicAuth).toBeDefined()
    expect(basicAuth?.supported).toBe(false)
  })

  it('apiKey-multi fixture: emits a machine-readable multi-header advisory', async () => {
    const out = (await spawnScriptJson('describe.mjs', [
      FIXTURE_PATHS.apiKeyMulti,
      '--no-probe',
    ])) as DescribeOutput

    expect(out.advisories.some(a => a.kind === 'multiHeaderAuth')).toBe(true)
  })
})

describe('scaffold.mjs against cached fixtures', () => {
  const cleanupTargets: string[] = []

  afterEach(async () => {
    while (cleanupTargets.length) {
      const target = cleanupTargets.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('petstore v2 one-to-one: writes 5 tool files + a valid project tree', async () => {
    // scaffold.mjs refuses to write into an existing target, so we
    // mkdtemp a parent and let scaffold create the project subdir.
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-smoke-'))
    cleanupTargets.push(parent)
    const target = path.join(parent, 'petstore-v2-smoke')

    const out = (await spawnScriptJson('scaffold.mjs', [
      FIXTURE_PATHS.petstoreV2,
      target,
      '--selections',
      PETSTORE_V2_SELECTIONS,
    ])) as ScaffoldOutput

    expect(out.mode).toBe('one-to-one')
    expect(out.operationsGenerated).toHaveLength(5)
    expect(out.operationsGenerated.map(o => o.operationId).sort()).toEqual(
      ['addPet', 'findPetsByStatus', 'getInventory', 'getPetById', 'updatePet'],
    )

    // Top-level files the template promises.
    await expect(stat(path.join(target, 'wrangler.jsonc'))).resolves.toBeDefined()
    await expect(stat(path.join(target, 'package.json'))).resolves.toBeDefined()
    await expect(stat(path.join(target, 'src', 'worker.ts'))).resolves.toBeDefined()

    // The generated tools directory mirrors the selection set exactly:
    // 5 op files + index.ts.
    const toolFiles = (await readdir(path.join(target, 'src', 'tools')))
      .filter(name => name.endsWith('.ts'))
      .sort()
    expect(toolFiles).toEqual(
      [
        'addPet.ts',
        'findPetsByStatus.ts',
        'getInventory.ts',
        'getPetById.ts',
        'index.ts',
        'updatePet.ts',
      ],
    )

    // package.json renders as plain JSON and carries the worker name
    // — cheapest proxy for "template substitutions applied".
    const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')) as {
      name: string
    }
    expect(pkg.name).toBe('petstore-v2-smoke')

    // wrangler.jsonc is JSONC (trailing commas + comments), so we don't
    // parse it — confirming the substitution landed is enough proof
    // the overlay rendered correctly.
    const wrangler = await readFile(path.join(target, 'wrangler.jsonc'), 'utf8')
    expect(wrangler).toContain('"name": "petstore-v2-smoke"')
  })

  it('--dev seeds SOLVAPAY_API_BASE_URL=api-dev when selections omit apiBaseUrl', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-dev-'))
    cleanupTargets.push(parent)
    const target = path.join(parent, 'petstore-v2-dev')

    await spawnScriptJson('scaffold.mjs', [
      FIXTURE_PATHS.petstoreV2,
      target,
      '--selections',
      PETSTORE_V2_SELECTIONS,
      '--dev',
    ])

    const env = await readFile(path.join(target, '.env'), 'utf8')
    expect(env).toContain('SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com')
  })

  it('explicit selections.apiBaseUrl wins over --dev', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-dev-explicit-'))
    cleanupTargets.push(parent)
    const target = path.join(parent, 'petstore-v2-explicit')

    // Pin apiBaseUrl in a temp selections file so the explicit > implicit
    // precedence is exercised end-to-end.
    const baseSelections = JSON.parse(await readFile(PETSTORE_V2_SELECTIONS, 'utf8')) as Record<
      string,
      unknown
    >
    const selectionsPath = path.join(parent, 'selections.json')
    await writeFile(
      selectionsPath,
      JSON.stringify({ ...baseSelections, apiBaseUrl: 'https://example.test/api' }),
      'utf8',
    )

    await spawnScriptJson('scaffold.mjs', [
      FIXTURE_PATHS.petstoreV2,
      target,
      '--selections',
      selectionsPath,
      '--dev',
    ])

    const env = await readFile(path.join(target, '.env'), 'utf8')
    expect(env).toContain('SOLVAPAY_API_BASE_URL=https://example.test/api')
    expect(env).not.toContain('api-dev.solvapay.com')
  })

  // Opt-in: install deps in the scaffolded project and run `tsc --noEmit` to
  // confirm the template compiles end-to-end. Costs ~4s install + ~0.6s tsc
  // on a warm cache (~15–30s cold), so we gate it behind an env var to keep
  // the default `npm test` loop fast. Run with `SOLVAPAY_SMOKE_TSC=1 npm test`.
  it.runIf(process.env.SOLVAPAY_SMOKE_TSC === '1')(
    'petstore v2 scaffold: `npm install && tsc --noEmit` passes (opt-in)',
    async () => {
      const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-tsc-'))
      cleanupTargets.push(parent)
      const target = path.join(parent, 'petstore-v2-tsc')

      await spawnScriptJson('scaffold.mjs', [
        FIXTURE_PATHS.petstoreV2,
        target,
        '--selections',
        PETSTORE_V2_SELECTIONS,
      ])

      const install = await runCommand(
        'npm',
        ['install', '--no-audit', '--no-fund', '--prefer-offline', '--silent'],
        target,
      )
      expect(
        install.exitCode,
        `npm install failed:\n--stdout--\n${install.stdout}\n--stderr--\n${install.stderr}`,
      ).toBe(0)

      const tsc = await runCommand('npx', ['tsc', '--noEmit'], target)
      expect(
        tsc.exitCode,
        `tsc --noEmit failed:\n--stdout--\n${tsc.stdout}\n--stderr--\n${tsc.stderr}`,
      ).toBe(0)
    },
    120_000,
  )
})

describe.skipIf(!LIVE_MODE)('describe.mjs live-mode probe (SOLVAPAY_SMOKE_LIVE=1)', () => {
  // Per-fixture expected probe status:
  //   - petstoreV2 + pokeapi: absolute `servers[0]` URLs → probe should
  //     reach the upstream and return 'ok'.
  //   - petstoreV3: the upstream spec ships `servers: [{ url: "/api/v3" }]`
  //     (relative), so `runServerProbe` cannot resolve it and reports
  //     'error'. That's the spec's behaviour, not a regression — the
  //     assertion below pins it so an upstream switch to absolute URLs
  //     surfaces here instead of silently changing probe semantics.
  const expected = {
    petstoreV2: 'ok',
    petstoreV3: 'error',
    pokeapi: 'ok',
  } as const

  for (const [label, fixture] of Object.entries(FIXTURE_PATHS)) {
    it(`${label} server probe matches expected status`, async () => {
      const out = (await spawnScriptJson('describe.mjs', [fixture])) as DescribeOutput
      expect(out.serverProbe.status).toBe(expected[label as keyof typeof expected])
    }, 15000)
  }
})
