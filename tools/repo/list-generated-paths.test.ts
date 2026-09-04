import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../shared/paths.js'
import { generatedDriftPaths } from '../shared/repo-paths.js'
import { runCli } from './list-generated-paths.js'

describe('list-generated-paths', () => {
  it('prints generatedDriftPaths one per line', () => {
    const result = runCli()
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(`${generatedDriftPaths().join('\n')}\n`)
  })
})

describe('pre-commit generated restage list', () => {
  it('derives git add paths from list-generated-paths, not a hardcoded block', () => {
    const hook = readFileSync(path.join(REPO_ROOT, '.husky/pre-commit'), 'utf8')
    expect(hook).toMatch(/list-generated-paths/)
    for (const rel of generatedDriftPaths()) {
      expect(hook.includes(rel), `pre-commit must not hardcode ${rel}`).toBe(false)
    }
  })
})
