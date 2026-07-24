import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveSnapshot,
  deriveSource,
  serializeSnapshot,
  type OpenApiSpec,
} from './lib/openapi-pipeline.js'
import { runCli } from './snapshot-openapi.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = path.join(REPO_ROOT, 'scripts/fixtures/synthetic-openapi.json')
const TEMP_ROOT = path.join(REPO_ROOT, 'scripts/.tmp')

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
})
