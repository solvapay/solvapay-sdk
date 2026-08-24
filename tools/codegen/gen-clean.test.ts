import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generatedEntry, lookupPath } from '../shared/repo-paths.js'
import { executeClean, interpretVerifyStatus, planClean, realCleanFs } from './gen-clean.js'

const TEMP_ROOT = lookupPath('scriptsTmp')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  mkdirSync(TEMP_ROOT, { recursive: true })
  const dir = mkdtempSync(path.join(TEMP_ROOT, 'gen-clean-'))
  tempDirs.push(dir)
  return dir
}

describe('planClean', () => {
  it('should return nodeBindings driftPaths and exclude lib.rs', () => {
    const plan = planClean()
    const entry = generatedEntry('nodeBindings')
    const drift = entry.driftPaths ?? []
    expect(drift.length).toBeGreaterThan(0)
    for (const rel of drift) {
      expect(plan.files.some(file => file.rel === rel)).toBe(true)
    }
    expect(plan.files.some(file => file.rel === `${entry.path}/lib.rs`)).toBe(false)
  })

  it('should return the directory for rustDto', () => {
    const plan = planClean()
    const entry = generatedEntry('rustDto')
    expect(plan.directories.some(dir => dir.rel === entry.path)).toBe(true)
  })
})

describe('executeClean', () => {
  it('should refuse a file lacking a generated marker', () => {
    const root = makeTempDir()
    const rel = 'keep/handwritten.rs'
    mkdirSync(path.join(root, 'keep'), { recursive: true })
    writeFileSync(path.join(root, rel), 'pub fn keep() {}\n')

    const result = executeClean(
      { files: [{ id: 'fake', rel }], directories: [] },
      realCleanFs(root),
    )

    expect(result.errors).toContain(rel)
    expect(existsSync(path.join(root, rel))).toBe(true)
    expect(readFileSync(path.join(root, rel), 'utf8')).toContain('pub fn keep')
  })

  it('should report already-absent files without failing', () => {
    const root = makeTempDir()
    const rel = 'missing/generated.rs'
    const result = executeClean(
      { files: [{ id: 'fake', rel }], directories: [] },
      realCleanFs(root),
    )

    expect(result.alreadyAbsent).toEqual([rel])
    expect(result.errors).toEqual([])
    expect(result.removed).toEqual([])
  })
})

describe('interpretVerifyStatus', () => {
  it('should report a deleted path as cleaned but not regenerated', () => {
    const rel = `${generatedEntry('nodeBindings').path}/args.rs`
    const report = interpretVerifyStatus(` D ${rel}\n`, [rel])
    expect(report.missing).toContain(rel)
  })

  it('should report success for a clean git status', () => {
    const report = interpretVerifyStatus('', [`${generatedEntry('nodeBindings').path}/args.rs`])
    expect(report.missing).toEqual([])
  })
})
