/**
 * Coverage for 64-bit integer handling. JavaScript numbers are only exact
 * up to 2^53 - 1, so int64 IDs (e.g. the live Petstore's
 * 9223372036854775271) were silently rounded on parse and re-send.
 *
 * Three slices:
 *   1. Template `upstreamFetchJson` — unsafe integers come back as exact
 *      decimal strings; safe numbers and floats are untouched.
 *   2. Template `stringifyLossless` + `int64` schema — digit strings go
 *      back as bare JSON numbers only for the listed keys.
 *   3. End-to-end scaffold — int64 params use `int64`, int32 params keep
 *      `z.number().int()`, and bodies with integer properties are sent
 *      through `stringifyLossless` with the collected key names.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { int64 } from '../../../templates/mcp/_base/src/lib/int64'
import { stringifyLossless, upstreamFetchJson } from '../../../templates/mcp/_base/src/lib/upstreamFetch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(HERE, '__fixtures__')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..', '..', 'scripts', 'mcp')

const SPEC = path.join(FIXTURES_DIR, 'int64.spec.json')
const SELECTIONS = path.join(FIXTURES_DIR, 'int64.selections.json')

describe('template upstreamFetchJson — lossless integers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns unsafe integers as exact strings and leaves other values alone', async () => {
    const body =
      '{"id":9223372036854775271,"owner":{"accountId":-1234567890123456789},' +
      '"count":42,"price":1.5,"big":1e20,"phone":"0701234567","parts":[{"partId":9007199254740993}]}'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })),
    )

    const data = await upstreamFetchJson<Record<string, unknown>>('https://api.example.com/v1/widgets/1')

    expect(data).toEqual({
      id: '9223372036854775271',
      owner: { accountId: '-1234567890123456789' },
      count: 42,
      price: 1.5,
      big: 1e20,
      phone: '0701234567',
      parts: [{ partId: '9007199254740993' }],
    })
  })
})

describe('template stringifyLossless', () => {
  it('writes listed digit-string keys as bare numbers and keeps other strings', () => {
    const out = stringifyLossless(
      { id: '9223372036854775271', owner: { accountId: '-42' }, phone: '0701234567', count: 3 },
      new Set(['id', 'accountId']),
    )
    expect(out).toBe('{"id":9223372036854775271,"owner":{"accountId":-42},"phone":"0701234567","count":3}')
  })

  it('round-trips an upstream int64 exactly', async () => {
    const source = '{"id":9223372036854775271,"name":"rex"}'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { status: 200 })))
    const parsed = await upstreamFetchJson<Record<string, unknown>>('https://api.example.com/v1/widgets/1')
    vi.unstubAllGlobals()
    expect(stringifyLossless(parsed, new Set(['id']))).toBe(source)
  })
})

describe('template int64 schema', () => {
  it('accepts safe integers and digit strings', () => {
    expect(int64.safeParse(42).success).toBe(true)
    expect(int64.safeParse('9223372036854775271').success).toBe(true)
    expect(int64.safeParse('-12').success).toBe(true)
  })

  it('rejects unsafe numbers, decimals and non-digit strings', () => {
    expect(int64.safeParse(9223372036854775000).success).toBe(false)
    expect(int64.safeParse(1.5).success).toBe(false)
    expect(int64.safeParse('12a').success).toBe(false)
  })
})

describe('scaffold.mjs — end-to-end int64', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    while (cleanup.length) {
      const target = cleanup.pop()
      if (target) await rm(target, { recursive: true, force: true })
    }
  })

  it('types int64 params with int64 and sends integer body keys losslessly', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'create-solvapay-int64-'))
    cleanup.push(parent)
    const target = path.join(parent, 'int64-smoke')

    const result = await spawnScript('scaffold.mjs', [SPEC, target, '--selections', SELECTIONS])
    expect(result.exitCode, `scaffold.mjs failed:\n--stderr--\n${result.stderr}`).toBe(0)

    const getWidget = await readFile(path.join(target, 'src', 'tools', 'getWidget.ts'), 'utf8')
    expect(getWidget).toContain("import { int64 } from '../lib/int64'")
    expect(getWidget).toContain('widgetId: int64.describe("Widget ID"),')
    expect(getWidget).toContain('revision: z.number().int().optional(),')
    expect(getWidget).toContain("import { upstreamFetchJson } from '../lib/upstreamFetch'")

    const createWidget = await readFile(path.join(target, 'src', 'tools', 'createWidget.ts'), 'utf8')
    expect(createWidget).toContain("import { upstreamFetchJson, stringifyLossless } from '../lib/upstreamFetch'")
    expect(createWidget).toContain(
      'body: stringifyLossless(input.body ?? {}, new Set(["accountId","id","partId"])),',
    )
    expect(createWidget).not.toContain("from '../lib/int64'")

    // No integer body properties → plain JSON.stringify, no extra import.
    const setLabel = await readFile(path.join(target, 'src', 'tools', 'setWidgetLabel.ts'), 'utf8')
    expect(setLabel).toContain('body: JSON.stringify(input.body ?? {}),')
    expect(setLabel).toContain("import { upstreamFetchJson } from '../lib/upstreamFetch'")
    expect(setLabel).toContain("import { int64 } from '../lib/int64'")

    const int64Lib = await readFile(path.join(target, 'src', 'lib', 'int64.ts'), 'utf8')
    expect(int64Lib).toContain('export const int64')
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
