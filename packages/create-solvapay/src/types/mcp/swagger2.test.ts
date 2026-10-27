/**
 * Swagger 2.0 coverage for the one-to-one path. Swagger 2 differs from
 * OpenAPI 3 in two ways the parser has to bridge:
 *
 *   1. Non-body parameters carry `type` / `format` / `enum` on the
 *      parameter itself, not under `schema`. Reading only `schema` typed
 *      every Swagger 2 param as `z.string()`.
 *   2. The JSON body is an `in: body` parameter, not `requestBody`. It was
 *      exposed as a `body` input but never sent upstream.
 *
 * Also pins that tools with a body send `content-type: application/json`
 * even when `upstreamAuth.kind` is `none` (the live Petstore answers 415
 * to a text/plain body).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listOperations,
  // @ts-expect-error — `scripts/mcp/lib/openapi.mjs` is a plain ESM module
  // with no .d.ts; the shape consumed here is pinned by the assertions.
} from '../../../scripts/mcp/lib/openapi.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const SPEC = path.join(FIXTURES_DIR, 'petstore-v2.spec.json')
const SELECTIONS = path.join(FIXTURES_DIR, 'petstore-v2.selections.json')

type Operation = {
  operationId: string
  parameters: Array<{ name: string; in: string; type: string; format: string | null }>
  requestBody: { required: boolean; schema: unknown } | null
}

describe('listOperations — Swagger 2.0', () => {
  const spec = {
    swagger: '2.0',
    consumes: ['application/json'],
    paths: {
      '/pet/{petId}': {
        get: {
          operationId: 'getPetById',
          parameters: [{ name: 'petId', in: 'path', required: true, type: 'integer', format: 'int64' }],
        },
        post: {
          operationId: 'updatePetWithForm',
          consumes: ['application/x-www-form-urlencoded'],
          parameters: [
            { name: 'petId', in: 'path', required: true, type: 'integer', format: 'int64' },
            { name: 'body', in: 'body', schema: { type: 'object' } },
          ],
        },
      },
      '/pet': {
        post: {
          operationId: 'addPet',
          parameters: [
            {
              name: 'body',
              in: 'body',
              required: true,
              schema: { type: 'object', properties: { id: { type: 'integer', format: 'int64' } } },
            },
          ],
        },
      },
    },
  }
  const ops = Object.fromEntries(
    (listOperations(spec) as Operation[]).map(op => [op.operationId, op]),
  )

  it('reads type and format from the parameter itself', () => {
    expect(ops.getPetById.parameters).toEqual([
      expect.objectContaining({ name: 'petId', in: 'path', type: 'integer', format: 'int64' }),
    ])
  })

  it('lifts the in: body parameter into requestBody and drops it from parameters', () => {
    expect(ops.addPet.parameters).toEqual([])
    expect(ops.addPet.requestBody).toEqual({
      required: true,
      schema: { type: 'object', properties: { id: { type: 'integer', format: 'int64' } } },
      example: undefined,
    })
  })

  it('ignores a body parameter on an operation that only consumes non-JSON media', () => {
    expect(ops.updatePetWithForm.requestBody).toBeNull()
    expect(ops.updatePetWithForm.parameters.map(p => p.in)).toEqual(['path'])
  })
})

describe('scaffold.mjs — end-to-end Swagger 2.0 Petstore', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('types params from the spec and sends the body as JSON', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-swagger2-'))
    cleanup.push(parent)
    const target = path.join(parent, 'petstore-v2-smoke')

    const result = await spawnScript('scaffold.mjs', [SPEC, target, '--selections', SELECTIONS])
    expect(result.exitCode, `scaffold.mjs failed:\n--stderr--\n${result.stderr}`).toBe(0)

    const getPet = await readFile(path.join(target, 'src', 'tools', 'getPetById.ts'), 'utf8')
    expect(getPet).toContain('petId: int64.describe("ID of pet to return"),')

    const findByStatus = await readFile(path.join(target, 'src', 'tools', 'findPetsByStatus.ts'), 'utf8')
    expect(findByStatus).toContain('status: z.array(z.unknown())')

    const addPet = await readFile(path.join(target, 'src', 'tools', 'addPet.ts'), 'utf8')
    expect(addPet).toContain("headers: { 'content-type': 'application/json' },")
    expect(addPet).toContain('body: stringifyLossless(input.body ?? {}, new Set(["id"])),')
    // upstreamAuth.kind is `none`, so the aggregator calls register*(ctx).
    expect(addPet).toContain('export function registerAddPet(ctx: AdditionalToolsContext) {')
    expect(addPet).not.toContain("import type { Env } from '../worker'")
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
