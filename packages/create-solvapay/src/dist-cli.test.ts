/**
 * Smoke the compiled `dist/cli.js` the way `npx create-solvapay` runs it.
 * Source-relative `../../../templates/...` paths work from `src/` and fail
 * from `dist/` — these cases would have caught the published-package
 * next-auth0 ENOENT and relative `--openapi` cwd bugs.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PACKAGE_VERSION } from './version-banner'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(HERE, '..')
const CLI = path.join(PACKAGE_DIR, 'dist', 'cli.js')

const MINI_PETSTORE = {
  openapi: '3.0.0',
  info: { title: 'Tiny petstore', version: '1.0.0' },
  servers: [{ url: 'https://petstore.swagger.io/v2' }],
  paths: {
    '/pet/{petId}': {
      get: {
        operationId: 'getPetById',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
}

const cleanupTargets: string[] = []

afterEach(async () => {
  while (cleanupTargets.length) {
    const target = cleanupTargets.pop()
    if (target) await rm(target, { recursive: true, force: true })
  }
})

beforeAll(async () => {
  const build = await runCommand(
    'pnpm',
    ['exec', 'tsup', '--config', 'tsup.config.ts'],
    PACKAGE_DIR,
  )
  if (build.exitCode !== 0) {
    throw new Error(`tsup failed:\n--stdout--\n${build.stdout}\n--stderr--\n${build.stderr}`)
  }
}, 60_000)

describe('dist/cli.js published-package paths', () => {
  it('scaffolds next-auth0 from the bundled entry', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-dist-auth0-'))
    cleanupTargets.push(cwd)

    const result = await runCli(cwd, [
      'auth0-app',
      '--type',
      'next-auth0',
      '--skip-install',
      '--skip-init',
      '--yes',
    ])

    expect(result.exitCode, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain(`create-solvapay v${PACKAGE_VERSION}`)

    const pkg = JSON.parse(await readFile(path.join(cwd, 'auth0-app', 'package.json'), 'utf8')) as {
      name: string
    }
    expect(pkg.name).toBe('auth0-app')
    expect(pkg.name).not.toContain('__PROJECT_NAME__')
    await expect(readFile(path.join(cwd, 'auth0-app', 'app', 'page.tsx'), 'utf8')).resolves.toBeTruthy()
    await expect(readFile(path.join(cwd, 'auth0-app', '.gitignore'), 'utf8')).resolves.toBeTruthy()
  }, 60_000)

  it('scaffolds mcp from-scratch from the bundled entry', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-dist-scratch-'))
    cleanupTargets.push(cwd)

    const result = await runCli(cwd, [
      'mcp-scratch',
      '--type',
      'mcp',
      '--no-openapi',
      '--skip-install',
      '--skip-init',
      '--yes',
    ])

    expect(result.exitCode, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain(`create-solvapay v${PACKAGE_VERSION}`)
    await expect(
      readFile(path.join(cwd, 'mcp-scratch', 'wrangler.jsonc'), 'utf8'),
    ).resolves.toBeTruthy()
    await expect(
      readFile(path.join(cwd, 'mcp-scratch', 'src', 'tools', 'helloTool.ts'), 'utf8'),
    ).resolves.toBeTruthy()
  }, 60_000)

  it('resolves a relative --openapi path against the user cwd', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-dist-openapi-'))
    cleanupTargets.push(cwd)
    await writeFile(path.join(cwd, 'petstore.json'), JSON.stringify(MINI_PETSTORE), 'utf8')

    const result = await runCli(cwd, [
      'mcp-openapi',
      '--type',
      'mcp',
      '--openapi',
      './petstore.json',
      '--skip-install',
      '--skip-init',
      '--yes',
    ])

    expect(result.exitCode, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain(`create-solvapay v${PACKAGE_VERSION}`)
    await expect(
      readFile(path.join(cwd, 'mcp-openapi', 'src', 'tools', 'getPetById.ts'), 'utf8'),
    ).resolves.toBeTruthy()
  }, 60_000)
})

async function runCli(
  cwd: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runCommand(process.execPath, [CLI, ...args], cwd)
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
