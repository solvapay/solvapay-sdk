/**
 * Validator + codegen coverage for the `free-capped` operation tier
 * in `scripts/mcp/scaffold.mjs`.
 *
 * `suggestTier` stays `free` / `paid` / `skip` — a cap is a pricing
 * decision, not inferable from an HTTP verb. These tests cover the
 * agent-upgraded path: selections carry `tier: 'free-capped'` plus a
 * `freeLimit` block, and the generated tool calls `ctx.registerFree`.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')
const PETSTORE_SPEC = path.join(FIXTURES_DIR, 'petstore-v2.spec.json')

const BASE_SELECTIONS = {
  workerName: 'free-capped-smoke',
  mcpPublicBaseUrl: 'http://localhost:8787',
  upstreamAuth: { kind: 'none' },
  mode: 'one-to-one',
}

describe('scaffold.mjs — free-capped validator', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('rejects free-capped without freeLimit', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...BASE_SELECTIONS,
      operations: [{ operationId: 'getPetById', tier: 'free-capped' }],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/freeLimit/)
  })

  it('rejects a meter that does not match free-*', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...BASE_SELECTIONS,
      operations: [
        {
          operationId: 'getPetById',
          tier: 'free-capped',
          freeLimit: { meter: 'requests', cap: 5, scope: 'lifetime' },
        },
      ],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/freeLimit\.meter/)
  })

  it('rejects rolling_window without windowDays', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...BASE_SELECTIONS,
      operations: [
        {
          operationId: 'getPetById',
          tier: 'free-capped',
          freeLimit: { cap: 5, scope: 'rolling_window' },
        },
      ],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/windowDays/)
  })

  it('rejects freeLimit on a non-free-capped tier', async () => {
    const { exitCode, stderr } = await runScaffoldWithSelections({
      ...BASE_SELECTIONS,
      operations: [
        {
          operationId: 'getPetById',
          tier: 'free',
          freeLimit: { cap: 5, scope: 'lifetime' },
        },
      ],
    })
    expect(exitCode).not.toBe(0)
    expect(stderr).toMatch(/only valid with tier `free-capped`/)
  })

  async function runScaffoldWithSelections(
    selections: Record<string, unknown>,
  ): Promise<{ exitCode: number; stderr: string }> {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-free-capped-neg-'))
    cleanup.push(parent)
    const selectionsPath = path.join(parent, 'selections.json')
    await writeFile(selectionsPath, JSON.stringify(selections), 'utf8')
    const target = path.join(parent, 'project')
    const result = await spawnScript('scaffold.mjs', [
      PETSTORE_SPEC,
      target,
      '--selections',
      selectionsPath,
    ])
    return { exitCode: result.exitCode, stderr: result.stderr }
  }
})

describe('scaffold.mjs — end-to-end free-capped', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('emits ctx.registerFree with the limit block', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-free-capped-'))
    cleanup.push(parent)
    const target = path.join(parent, 'free-capped-smoke')
    const selectionsPath = path.join(parent, 'selections.json')
    await writeFile(
      selectionsPath,
      JSON.stringify({
        ...BASE_SELECTIONS,
        operations: [
          {
            operationId: 'getPetById',
            tier: 'free-capped',
            freeLimit: {
              meter: 'free-previews',
              cap: 5,
              scope: 'rolling_window',
              windowDays: 30,
            },
          },
          { operationId: 'addPet', tier: 'paid' },
        ],
      }),
      'utf8',
    )

    const result = await spawnScript('scaffold.mjs', [
      PETSTORE_SPEC,
      target,
      '--selections',
      selectionsPath,
    ])
    expect(
      result.exitCode,
      `scaffold.mjs failed:\n--stderr--\n${result.stderr}`,
    ).toBe(0)

    const summary = JSON.parse(result.stdout) as {
      operationsGenerated: Array<{ operationId: string; tier: string }>
    }
    expect(summary.operationsGenerated).toEqual([
      { operationId: 'getPetById', tier: 'free-capped' },
      { operationId: 'addPet', tier: 'paid' },
    ])

    const freeTool = await readFile(path.join(target, 'src', 'tools', 'getPetById.ts'), 'utf8')
    expect(freeTool).toContain("ctx.registerFree('getPetById'")
    expect(freeTool).toContain(
      "limit: { meter: \"free-previews\", cap: 5, scope: \"rolling_window\", windowDays: 30 }",
    )
    expect(freeTool).toContain('return c.respond(data')
    expect(freeTool).not.toContain('ctx.server.registerTool')
    expect(freeTool).not.toContain('ctx.registerPayable')

    const paidTool = await readFile(path.join(target, 'src', 'tools', 'addPet.ts'), 'utf8')
    expect(paidTool).toContain("ctx.registerPayable('addPet'")
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
