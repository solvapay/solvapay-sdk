import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveSnapshot,
  deriveSource,
  serializeSnapshot,
  type OpenApiSpec,
} from './lib/openapi-pipeline.js'
import { lookupPath } from '../shared/repo-paths.js'
import { pathDiffReport, runCli } from './snapshot-openapi.js'

const FIXTURE = lookupPath('syntheticOpenapi')
const TEMP_ROOT = lookupPath('scriptsTmp')

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  mkdirSync(TEMP_ROOT, { recursive: true })
  const dir = mkdtempSync(path.join(TEMP_ROOT, 'openapi-snapshot-'))
  tempDirs.push(dir)
  return dir
}

describe('snapshot-openapi CLI', () => {
  it('--from-file --out writes expected source and snapshot bytes', async () => {
    const outDir = makeTempDir()
    const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as OpenApiSpec
    const expectedSource = serializeSnapshot(deriveSource(raw))
    const expectedSnapshot = serializeSnapshot(deriveSnapshot(raw))

    const first = await runCli(['--from-file', FIXTURE, '--out', outDir])
    expect(first.exitCode).toBe(0)

    const sourcePath = path.join(outDir, 'sdk-v1.source.json')
    const snapshotPath = path.join(outDir, 'sdk-v1.snapshot.json')
    expect(readFileSync(sourcePath, 'utf8')).toBe(expectedSource)
    expect(readFileSync(snapshotPath, 'utf8')).toBe(expectedSnapshot)

    const second = await runCli(['--from-file', FIXTURE, '--out', outDir])
    expect(second.exitCode).toBe(0)
    expect(readFileSync(sourcePath, 'utf8')).toBe(expectedSource)
    expect(readFileSync(snapshotPath, 'utf8')).toBe(expectedSnapshot)
  })

  it('--check exits 0 on match and non-zero with diff on mismatch', async () => {
    const outDir = makeTempDir()

    const write = await runCli(['--from-file', FIXTURE, '--out', outDir])
    expect(write.exitCode).toBe(0)

    const checkOk = await runCli([
      '--check',
      '--from-file',
      path.join(outDir, 'sdk-v1.source.json'),
      '--snapshot',
      path.join(outDir, 'sdk-v1.snapshot.json'),
    ])
    expect(checkOk.exitCode).toBe(0)

    const snapshotPath = path.join(outDir, 'sdk-v1.snapshot.json')
    writeFileSync(snapshotPath, '{\n  "tampered": true\n}\n')

    const checkFail = await runCli([
      '--check',
      '--from-file',
      path.join(outDir, 'sdk-v1.source.json'),
      '--snapshot',
      snapshotPath,
    ])
    expect(checkFail.exitCode).not.toBe(0)
    expect(`${checkFail.stdout}${checkFail.stderr}`).toMatch(/diff|mismatch|differ/i)
  })

  it('should derive a snapshot equal to the committed file from five identical stack specs', async () => {
    const outDir = makeTempDir()
    const source = JSON.parse(readFileSync(lookupPath('openapiSource'), 'utf8')) as OpenApiSpec
    const committed = readFileSync(lookupPath('openapiSnapshot'), 'utf8')
    const result = await runCli(['--from-stack', '--out', outDir], {
      fetchJson: async () => source,
    })
    expect(result.exitCode).toBe(0)
    expect(readFileSync(path.join(outDir, 'sdk-v1.snapshot.json'), 'utf8')).toBe(committed)
  })

  it('--check --from-stack exits 0 when the merged snapshot matches', async () => {
    const source = JSON.parse(readFileSync(lookupPath('openapiSource'), 'utf8')) as OpenApiSpec
    const result = await runCli(['--check', '--from-stack'], {
      fetchJson: async () => source,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/matches the running stack/i)
  })

  it('--check --from-stack fails when the stack snapshot drifted', async () => {
    const source = JSON.parse(readFileSync(lookupPath('openapiSource'), 'utf8')) as OpenApiSpec
    const drifted: OpenApiSpec = structuredClone(source)
    drifted.paths = {
      ...(source.paths ?? {}),
      '/v1/sdk/drift-probe': { get: { responses: { '200': { description: 'probe' } } } },
    }
    const result = await runCli(['--check', '--from-stack'], {
      fetchJson: async () => drifted,
    })
    expect(result.exitCode).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/mismatch|differ/i)
  })

  it('pathDiffReport reads --snapshot rather than the default path', () => {
    const dir = makeTempDir()
    const snapshotPath = path.join(dir, 'custom.snapshot.json')
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        paths: { '/only-custom': {} },
      }),
    )
    const report = pathDiffReport(
      { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: { '/from-spec': {} } },
      snapshotPath,
    )
    expect(report).toContain('/from-spec')
    expect(report).toContain('/only-custom')
  })

  it('fails --from-stack when a service is unreachable', async () => {
    const outDir = makeTempDir()
    const source = JSON.parse(readFileSync(lookupPath('openapiSource'), 'utf8')) as OpenApiSpec
    const result = await runCli(['--from-stack', '--out', outDir], {
      fetchJson: async url => {
        if (url.includes(':3005')) {
          throw new Error('connect ECONNREFUSED')
        }
        return source
      },
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/3005/)
  })
})
